import { resolveItemTool } from '@kahanmilega/shared/tools';
import type { Logger } from 'pino';
import type { Queryable } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import type { AiContext, ToolCall } from '../ai/index.js';
import { getItem, resolveForCustomer } from '../catalog/index.js';
import { linkErrandPhoto } from '../photos/index.js';
import { planRoute } from '../routing/index.js';
import { findLearnedStock } from '../shops/index.js';
import { createRequest, type RequestsContext } from '../requests/index.js';
import { statusForModel } from './bridge.js';
import { linkRequest, listLinks, type ErrandQuestion } from './persistence.js';
import {
  askShopsAgentInput,
  askUserInput,
  findItemNearbyAgentInput,
  getRequestStatusAgentInput,
  planRouteAgentInput,
  submitPlanInput,
  type SubmitPlanInput,
} from './tools.js';

const DEFAULT_RADIUS_M = 2000;
/** The model reads at most this many shops per item: it keeps a step small. */
const MAX_SHOPS_SHOWN = 8;
const DAY_MS = 24 * 3_600_000;

/** What the agent has found so far; kept for the partial plan of a failed errand. */
export interface FoundItem {
  label: string;
  itemId: string;
  itemName: string;
  shops: {
    shopId: string;
    name: string;
    distanceM: number;
    pricePaise: number | null;
    freshness: string;
  }[];
}

export interface RunState {
  /** itemId → the customer's own word for it, learned from resolve_item. */
  labels: Map<string, string>;
  found: Map<string, FoundItem>;
  /** itemId → the customer's word, for every item resolve_item placed (not the options of a question). */
  resolved: Map<string, string>;
  /** Questions put to the customer so far in this errand, across runs. */
  questionsAsked: number;
}

export const newRunState = (): RunState => ({
  labels: new Map(),
  found: new Map(),
  resolved: new Map(),
  questionsAsked: 0,
});

export interface ToolEnv {
  db: Queryable;
  errandId: string;
  /** For ask_shops and get_request_status: opens and reads this user's requests. */
  requests: RequestsContext;
  maxAskShops: number;
  maxQuestions: number;
  logger: Logger;
  ai: AiContext | undefined;
  userId: string;
  /** Where the user is. Tools use it; the model never sees it. */
  where: { lat: number; lng: number };
  requestId: string | null;
  trigramThreshold: number;
  maxItems: number;
  state: RunState;
}

export interface ToolOutcome {
  /** What the model is told. */
  result: unknown;
  /** The small digest kept in errand_steps. */
  summary: Record<string, unknown>;
  /** Set when submit_plan was accepted. */
  submitted?: SubmitPlanInput;
  /** Set when ask_user was accepted: the run ends and the errand waits for the customer. */
  question?: ErrandQuestion;
  /** Set when ask_shops opened (or found) a request: the agent now has something to wait for. */
  asked?: boolean;
}

const failure = (message: string): ToolOutcome => ({
  result: { error: message },
  summary: { error: true },
});

const invalid = (issues: { path: PropertyKey[]; message: string }[]) =>
  failure(
    `invalid arguments: ${issues.map((i) => `${i.path.map(String).join('.') || 'input'}: ${i.message}`).join('; ')}`,
  );

/**
 * Runs one tool call in process, as the errand's user (ADR-0024). The same services the HTTP API
 * uses, no HTTP in between. A tool that is not in the agent's list, or is given bad arguments,
 * answers with an error the model can read; nothing here throws for the model's mistakes.
 */
export async function executeTool(env: ToolEnv, call: ToolCall): Promise<ToolOutcome> {
  switch (call.name) {
    case 'resolve_item':
      return resolveItem(env, call.args);
    case 'find_item_nearby':
      return findItemNearby(env, call.args);
    case 'ask_shops':
      return askShops(env, call.args);
    case 'get_request_status':
      return requestStatus(env, call.args);
    case 'ask_user':
      return askUser(env, call.args);
    case 'plan_route':
      return routeFor(env, call.args);
    case 'submit_plan':
      return submitPlan(env, call.args);
    default:
      return failure(
        `unknown tool "${call.name.slice(0, 40)}". Available: resolve_item, find_item_nearby, ask_shops, get_request_status, ask_user, plan_route, submit_plan.`,
      );
  }
}

async function resolveItem(env: ToolEnv, args: unknown): Promise<ToolOutcome> {
  const parsed = resolveItemTool.input.safeParse(args);
  if (!parsed.success) return invalid(parsed.error.issues);
  const { text } = parsed.data;
  try {
    const resolution = await resolveForCustomer(env.db, text, {
      userId: env.userId,
      threshold: env.trigramThreshold,
      ...(env.requestId && { requestId: env.requestId }),
      ...(env.ai && { ai: env.ai }),
      logger: env.logger,
    });
    if (!resolution.item) {
      return {
        result: {
          unresolved: true,
          message: `Nothing in the catalog fits "${text}". Mark it not_found.`,
        },
        summary: { status: 'unresolved' },
      };
    }
    const { item } = resolution;
    env.state.labels.set(item.id, text);
    if (!env.state.resolved.has(item.id)) env.state.resolved.set(item.id, text);
    return {
      result: {
        item: {
          id: item.id,
          name: item.nameEn,
          nameHi: item.nameHi,
          category: item.category,
          categories: item.categories,
        },
      },
      summary: { status: 'resolved', itemName: item.nameEn },
    };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'item_ambiguous') {
      const options = (error.details['options'] ?? []) as {
        itemId: string;
        nameEn: string;
        nameHi: string;
      }[];
      for (const o of options)
        if (!env.state.labels.has(o.itemId)) env.state.labels.set(o.itemId, text);
      return {
        result: {
          clarification: {
            question: error.details['question'],
            options: options.map((o) => ({ itemId: o.itemId, name: o.nameEn, nameHi: o.nameHi })),
          },
          message:
            'The customer must choose: call ask_user with this question and these option names (do not guess). If you have already asked the maximum, pick the most common option, use its itemId and say so in the notes.',
        },
        summary: { status: 'clarification' },
      };
    }
    throw error;
  }
}

async function findItemNearby(env: ToolEnv, args: unknown): Promise<ToolOutcome> {
  const parsed = findItemNearbyAgentInput.safeParse(args);
  if (!parsed.success) return invalid(parsed.error.issues);
  const { itemId, radiusM } = parsed.data;
  const item = await getItem(env.db, itemId);
  if (!item) {
    return failure('unknown itemId. Use an id returned by resolve_item.');
  }
  const stock = await findLearnedStock(
    env.db,
    itemId,
    env.where.lat,
    env.where.lng,
    radiusM ?? DEFAULT_RADIUS_M,
  );
  const now = Date.now();
  const freshCount = stock.filter((s) => now - s.lastConfirmedAt.getTime() < DAY_MS).length;
  const shops = stock.slice(0, MAX_SHOPS_SHOWN).map((s) => ({
    shopId: s.shopId,
    name: s.name,
    distanceM: s.distanceM,
    pricePaise: s.pricePaise,
    freshness: s.freshness,
  }));
  const label = env.state.labels.get(itemId) ?? item.nameEn;
  env.state.found.set(itemId, { label, itemId, itemName: item.nameEn, shops });
  return {
    result: { count: stock.length, freshCount, shops },
    summary: { label, itemName: item.nameEn, count: stock.length, freshCount },
  };
}

async function askShops(env: ToolEnv, args: unknown): Promise<ToolOutcome> {
  const parsed = askShopsAgentInput.safeParse(args);
  if (!parsed.success) return invalid(parsed.error.issues);
  const { itemId, targetPricePaise } = parsed.data;
  const item = await getItem(env.db, itemId);
  if (!item) return failure('unknown itemId. Use an id returned by resolve_item.');
  const label = env.state.labels.get(itemId) ?? item.nameEn;

  // Asking again about the same item is free: it is the same request.
  const links = await listLinks(env.db, env.errandId);
  const existing = links.find((l) => l.itemId === itemId);
  if (existing) {
    const status = await statusForModel(env.requests, env.userId, existing.requestId);
    return {
      result: {
        requestId: existing.requestId,
        state: status?.state ?? 'PINGING',
        reused: true,
        message: 'You already asked shops about this item. Wait for the answers; do not ask again.',
      },
      summary: { label, requestId: existing.requestId, reused: true },
      asked: true,
    };
  }
  if (links.length >= env.maxAskShops) {
    return failure(
      `you have already asked shops about ${env.maxAskShops} items, the most allowed. Plan the rest from find_item_nearby and mark unchecked items not_found.`,
    );
  }
  try {
    // The key makes a retry (a worker that died after this call) find the same request.
    const { request } = await createRequest(env.requests, env.userId, {
      q: label,
      itemId,
      lat: env.where.lat,
      lng: env.where.lng,
      ...(targetPricePaise !== undefined && { targetPricePaise }),
      ...(env.requestId && { requestId: env.requestId }),
      idempotencyKey: `errand-${env.errandId}-${itemId}`,
    });
    await linkRequest(env.db, env.errandId, request.id, itemId);
    // A photo the customer gave this checklist item goes with its request (ADR-0030). Never to a model.
    await linkErrandPhoto(env.db, env.errandId, label, request.id);
    return {
      result: {
        requestId: request.id,
        state: request.state,
        message:
          request.state === 'ANSWERED'
            ? 'Enough shops already have it; read the status when you are resumed.'
            : 'Shops are being asked now. They answer over the next minutes: you will be resumed with their answers.',
      },
      summary: { label, requestId: request.id, state: request.state },
      asked: true,
    };
  } catch (error) {
    if (error instanceof ApiError) return failure(error.message);
    throw error;
  }
}

async function requestStatus(env: ToolEnv, args: unknown): Promise<ToolOutcome> {
  const parsed = getRequestStatusAgentInput.safeParse(args);
  if (!parsed.success) return invalid(parsed.error.issues);
  const { requestId } = parsed.data;
  const links = await listLinks(env.db, env.errandId);
  if (!links.some((l) => l.requestId === requestId))
    return failure('that request is not part of this errand. Use a requestId from ask_shops.');
  const status = await statusForModel(env.requests, env.userId, requestId);
  if (!status) return failure('unknown request.');
  return {
    result: status,
    summary: { state: status.state, yes: status.pingStats.yes, pending: status.pingStats.pending },
  };
}

async function askUser(env: ToolEnv, args: unknown): Promise<ToolOutcome> {
  const parsed = askUserInput.safeParse(args);
  if (!parsed.success) return invalid(parsed.error.issues);
  if (env.state.questionsAsked >= env.maxQuestions) {
    return failure(
      'no more questions are allowed in this errand. Pick the most common reading, say so in the notes, and carry on.',
    );
  }
  env.state.questionsAsked++;
  const { question, options, multiSelect, preselected } = parsed.data;
  return {
    result: { ok: true, asked: true },
    summary: { asked: true, question },
    question: {
      question,
      ...(options && { options }),
      ...(options && multiSelect && { multiSelect: true }),
      ...(options && multiSelect && preselected && { preselected: [...new Set(preselected)] }),
    },
  };
}

async function routeFor(env: ToolEnv, args: unknown): Promise<ToolOutcome> {
  const parsed = planRouteAgentInput.safeParse(args);
  if (!parsed.success) return invalid(parsed.error.issues);
  const ids = [...new Set(parsed.data.shopIds)];
  const { rows } = await env.db.query<{ id: string; name: string; lat: number; lng: number }>(
    `SELECT id, name, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
       FROM shops WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  const missing = ids.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length > 0) return failure('unknown shopId. Use ids returned by find_item_nearby.');
  const plan = planRoute(
    env.where,
    rows.map((r) => ({ shopId: r.id, label: r.name, lat: r.lat, lng: r.lng })),
  );
  const legsM = plan.legsM.map(Math.round);
  const totalM = legsM.reduce((a, b) => a + b, 0);
  return {
    result: {
      orderedStops: plan.orderedStops.map((s) => ({ shopId: s.shopId, name: s.label })),
      legsM,
      totalM,
    },
    summary: { stops: plan.orderedStops.length, totalM },
  };
}

async function submitPlan(env: ToolEnv, args: unknown): Promise<ToolOutcome> {
  const parsed = submitPlanInput.safeParse(args);
  if (!parsed.success) return invalid(parsed.error.issues);
  if (parsed.data.items.length > env.maxItems)
    return failure(`invalid arguments: at most ${env.maxItems} items in one plan`);
  // The plan itself is built (and checked) by the loop, which owns the errand.
  return { result: { ok: true }, summary: {}, submitted: parsed.data };
}
