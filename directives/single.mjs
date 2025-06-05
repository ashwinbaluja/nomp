import { generate } from "astring";
import * as acornWalk from "acorn-walk";
import { sharedMemoryManager } from "../memory.mjs";
import {
  parseCode,
  parseExpression,
  removeDirective,
} from "./helpers/ast-helpers.mjs";
import { parseArgs } from "./helpers/arg-parser.mjs";

export const Single = function (ast, origNode, args) {
  const sArgs = parseArgs(args);

  const wait = sArgs.wait?.values().next().value || "wait";

  const lockName = `__lock_for__${origNode.start}_${origNode.end}`;

  sharedMemoryManager.allocateInt(lockName, null, "int32", 1, true);

  removeDirective("single", ast, origNode);

  let parentNode;

  acornWalk.ancestor(ast, {
    BlockStatement(node, state, ancestors) {
      if (node === origNode) {
        parentNode = ancestors[ancestors.length - 2];
      }
    },
  });

  Object.assign(
    origNode,
    parseExpression(`
        {
            if (Atomics.compareExchange(
                nomp_shared_mem,
                nomp_mem_mapping.get("${lockName}").index,
                0,
                1
            ) === 0) {
                ${generate(origNode)}
            }
        }
    `)
  );

  if (wait == "wait") {
    parentNode.body.splice(
      parentNode.body.indexOf(origNode) + 1,
      0,
      parseExpression(
        `"nomp barrier name(single${origNode.start}${origNode.end})"`
      )
    );

    parentNode.body.splice(
      parentNode.body.indexOf(origNode) + 2,
      0,
      parseCode(`
                {
                    ''
                };
        `)
    );
  }

  return ast;
};
