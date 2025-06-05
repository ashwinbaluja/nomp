import { generate } from "astring";
import { sharedMemoryManager } from "../memory.mjs";
import { parseExpression, removeDirective } from "./helpers/ast-helpers.mjs";
import { parseArgs } from "./helpers/arg-parser.mjs";

export const Critical = function (ast, origNode, args) {
  const cArgs = parseArgs(args);

  const lockName = cArgs.name?.values().next().value || "default_lock";

  sharedMemoryManager.allocateLock(lockName);

  const wrappedBlock = parseExpression(`
    (() => {

      while (Atomics.compareExchange(
        nomp_shared_mem,
        nomp_mem_mapping.get("__lock_${lockName}__").index,
        0,
        1
      ) !== 0) {
        Atomics.wait(
          nomp_shared_mem,
          nomp_mem_mapping.get("__lock_${lockName}__").index,
          1
        );
      }

      try {
        ${generate(origNode)}
      } finally {
        Atomics.store(
          nomp_shared_mem,
          nomp_mem_mapping.get("__lock_${lockName}__").index,
          0
        );
        Atomics.notify(
          nomp_shared_mem,
          nomp_mem_mapping.get("__lock_${lockName}__").index,
          1
        );
      }
    })()
  `);

  Object.assign(origNode, wrappedBlock);

  removeDirective("critical", ast, origNode);

  return ast;
};
