import { generate } from "astring";
import { sharedMemoryManager } from "../memory.mjs";
import { parseCode, removeDirective } from "./helpers/ast-helpers.mjs";
import { parseArgs } from "./helpers/arg-parser.mjs";

export const Barrier = function (ast, origNode, args) {
  const bArgs = parseArgs(args);
  const barrierName = bArgs.name?.values().next().value || "default_barrier";

  const barrierInfo = sharedMemoryManager.allocateBarrier(barrierName);

  const barrierBlock = parseCode(`
    {
        (() => {
            const threadId = nomp_get_thread_id();

            const currentGeneration = Atomics.load(
                nomp_shared_mem,
                ${barrierInfo.generationIndex}
            );

            const pos = Atomics.add(
                nomp_shared_mem,
                ${barrierInfo.counterIndex},
                1
            );

            if (pos === nomp_num_threads - 1) {
                Atomics.store(
                    nomp_shared_mem,
                    ${barrierInfo.counterIndex},
                    0
                );

                Atomics.add(nomp_shared_mem, ${barrierInfo.generationIndex}, 1);

                Atomics.notify(
                    nomp_shared_mem,
                    ${barrierInfo.generationIndex},
                    nomp_num_threads - 1
                );
            } else {
                while (
                    Atomics.load(nomp_shared_mem, ${
                      barrierInfo.generationIndex
                    }) === currentGeneration
                ) {
                    Atomics.wait(
                        nomp_shared_mem,
                        ${barrierInfo.generationIndex},
                        currentGeneration
                    );
                }
            }
            return;
        })();
        ${generate(origNode)}
    }
  `);

  removeDirective("barrier", ast, origNode);

  Object.assign(origNode, barrierBlock);

  return ast;
};
