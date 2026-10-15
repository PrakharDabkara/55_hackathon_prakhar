import { GenericContainer } from 'testcontainers';

/** A throwaway Redis, same image as docker-compose. */
export async function startRedis() {
  const container = await new GenericContainer('redis:8.8.3-alpine').withExposedPorts(6379).start();
  return {
    url: `redis://${container.getHost()}:${container.getMappedPort(6379)}`,
    stop: () => container.stop().then(() => undefined),
  };
}
