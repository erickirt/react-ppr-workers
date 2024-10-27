import { PassThrough, Stream } from 'node:stream';
// @ts-expect-error no types
import { resumeToPipeableStream } from 'react-dom/server.node';
// @ts-expect-error no types
import { prerender } from 'react-dom/static.edge';
import App from '../app';
import { postponed } from '../prerender/data.json';

declare const IS_PRERENDER: boolean | undefined;

type Env = {
  DB: D1Database;
};

// Function to convert a Node.js pipeable stream into a Web ReadableStream
function toWebReadableStream(pipeableStream: Stream) {
  // Create a PassThrough stream to read data chunk by chunk
  const passthrough = new PassThrough();

  // Pipe the Node.js stream into the PassThrough stream
  pipeableStream.pipe(passthrough);

  return new ReadableStream({
    start(controller) {
      const reader = passthrough[Symbol.asyncIterator]();

      const pump = async () => {
        try {
          for await (const chunk of reader) {
            // Enqueue each chunk into the Web ReadableStream
            controller.enqueue(chunk);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      };

      pump();
    },
    cancel() {
      // Abort the Node.js stream when the web ReadableStream is canceled
      // @ts-expect-error no types / TODO: is there a way to do this without the expect error?
      pipeableStream.destroy();
      passthrough.destroy();
    },
  });
}

const headers = {
  'Content-Type': 'text/html; charset=utf-8',
  'Transfer-Encoding': 'chunked',
  // set caching header so it never caches
  'Cache-Control':
    'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (IS_PRERENDER) {
      // let's patch DB.prepare.all to have a tick
      // we probably want to do this to ALL async methods in some way
      const _prepare = env.DB.prepare.bind(env.DB);
      env.DB.prepare = (...args: Parameters<typeof _prepare>) => {
        const prepared = _prepare(...args);
        const _all = prepared.all.bind(prepared);
        prepared.all = async (...args: Parameters<typeof _all>) => {
          await new Promise((resolve) => setTimeout(resolve, 0));
          return _all(...args);
        };
        return prepared;
      };

      type Prerendered = {
        postponed: Record<string, unknown>;
        prelude: ReadableStream;
      };

      const controller = new AbortController();
      const prerendered = await new Promise<Prerendered>((resolve, reject) => {
        let result: Prerendered;
        setImmediate(() => {
          try {
            result = prerender(<App DB={env.DB} />, {
              signal: controller.signal,
            });
          } catch (error) {
            reject(error);
          }
        });
        setImmediate(() => {
          controller.abort();
          resolve(result);
        });
      });

      // prerendered.prelude is a ReadableStream, so we need to convert it to a string
      const prelude = await new Response(prerendered.prelude).text();

      return Response.json({
        prelude,
        postponed: prerendered.postponed,
      });
    }
    const resumed = await resumeToPipeableStream(
      <App DB={env.DB} />,
      structuredClone(postponed),
    );

    return new Response(toWebReadableStream(resumed), {
      headers,
    });
  },
} satisfies ExportedHandler<Env>;
