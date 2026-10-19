// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../test/render.js';
import { Button, LinkButton } from './Button.js';
import { Chip } from './Chip.js';
import { Field } from './Field.js';
import { Skeleton } from './Skeleton.js';
import { Stamp } from './Stamp.js';
import { Switch } from './Switch.js';
import { ToastProvider, useToast } from './Toast.js';

describe('Button', () => {
  it('is primary, secondary or quiet and says so in its class', () => {
    renderApp(
      <>
        <Button variant="primary">A</Button>
        <Button variant="secondary">B</Button>
        <Button variant="quiet">C</Button>
        <Button variant="ink">D</Button>
      </>,
      'en',
    );
    expect(screen.getByRole('button', { name: 'A' }).className).toContain('sh-btn--primary');
    expect(screen.getByRole('button', { name: 'B' }).className).toContain('sh-btn--secondary');
    expect(screen.getByRole('button', { name: 'C' }).className).toContain('sh-btn--quiet');
    expect(screen.getByRole('button', { name: 'D' }).className).toContain('sh-btn--ink');
  });

  it('is type=button unless told otherwise, and does not click while disabled', async () => {
    const onClick = vi.fn();
    const { user } = renderApp(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
      'en',
    );
    const button = screen.getByRole('button', { name: 'Go' });
    expect(button.getAttribute('type')).toBe('button');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders a link that looks like a button', () => {
    renderApp(
      <LinkButton href="https://maps.example/x" external>
        Open map
      </LinkButton>,
      'en',
    );
    const link = screen.getByRole('link', { name: 'Open map' });
    expect(link.getAttribute('href')).toBe('https://maps.example/x');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('target')).toBe('_blank');
  });
});

describe('Chip', () => {
  it('is a toggle that reports aria-pressed', async () => {
    const onClick = vi.fn();
    const { user } = renderApp(
      <Chip pressed onClick={onClick}>
        30 min
      </Chip>,
      'en',
    );
    const chip = screen.getByRole('button', { name: '30 min' });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    await user.click(chip);
    expect(onClick).toHaveBeenCalled();
  });

  it('can be disabled', () => {
    renderApp(
      <Chip pressed={false} disabled onClick={vi.fn()}>
        Dairy
      </Chip>,
      'en',
    );
    expect((screen.getByRole('button', { name: 'Dairy' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe('Field', () => {
  it('ties the label, helper and error to the input', () => {
    renderApp(
      <Field
        label="Mobile number"
        helper="We'll send a code."
        error="Enter 10 digits."
        value=""
        onChange={vi.fn()}
      />,
      'en',
    );
    const input = screen.getByLabelText('Mobile number');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = input.getAttribute('aria-describedby') ?? '';
    expect(described.split(' ').length).toBe(2);
    expect(screen.getByText('Enter 10 digits.').getAttribute('role')).toBe('alert');
  });

  it('shows a prefix and keeps text at 16px or more via its class', () => {
    renderApp(<Field label="Phone" prefix="+91" value="" onChange={vi.fn()} />, 'en');
    expect(screen.getByText('+91')).toBeTruthy();
    expect(screen.getByLabelText('Phone').className).toContain('sh-input');
  });

  it('is not invalid without an error', () => {
    renderApp(<Field label="Name" value="" onChange={vi.fn()} />, 'en');
    expect(screen.getByLabelText('Name').getAttribute('aria-invalid')).toBeNull();
  });
});

describe('Switch', () => {
  it('is a switch with a label that toggles', async () => {
    const onChange = vi.fn();
    const { user } = renderApp(
      <Switch checked={false} onChange={onChange} label="I deliver" />,
      'en',
    );
    const sw = screen.getByRole('switch', { name: 'I deliver' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await user.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('Skeleton and Stamp', () => {
  it('hides the skeleton from screen readers', () => {
    const { container } = renderApp(<Skeleton height="2rem" />, 'en');
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('stamps ANSWERED and NOT AVAILABLE', () => {
    renderApp(
      <>
        <Stamp variant="yes" />
        <Stamp variant="no" />
      </>,
      'en',
    );
    expect(screen.getByText('Answered').className).toContain('sh-stamp--yes');
    expect(screen.getByText('Not available').className).toContain('sh-stamp--no');
  });
});

describe('Toast', () => {
  function Trigger() {
    const toast = useToast();
    return <button onClick={() => toast("You're open.")}>show</button>;
  }

  it('announces a message politely and goes away by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { user } = renderApp(
        <ToastProvider>
          <Trigger />
        </ToastProvider>,
        'en',
      );
      await user.click(screen.getByText('show'));
      const status = screen.getByRole('status');
      expect(status.textContent).toContain("You're open.");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      await waitFor(() => expect(screen.queryByText("You're open.")).toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });
});
