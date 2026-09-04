import { PassThrough } from 'node:stream';
import type Docker from 'dockerode';

/** Enough of dockerode's `Container` for `createDockerRunner.run` to complete without a daemon. */
export function createFakeContainer(id: string): Docker.Container {
  return {
    id,
    modem: { demuxStream: () => {} },
    attach: async () => new PassThrough() as unknown as NodeJS.ReadWriteStream,
    start: async () => {},
    wait: async () => ({ StatusCode: 0 }),
    kill: async () => {},
    remove: async () => {},
  } as unknown as Docker.Container;
}

export function createFakeDocker(calls: Docker.ContainerCreateOptions[]): Docker {
  return {
    modem: { demuxStream: () => {} },
    createContainer: async (opts: Docker.ContainerCreateOptions) => {
      calls.push(opts);
      return createFakeContainer('fake-container-id');
    },
  } as unknown as Docker;
}
