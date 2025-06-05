import * as acornWalk from "acorn-walk";
import { generate } from "astring";
import {
  parseCode,
  parseExpression,
  removeDirective,
} from "./helpers/ast-helpers.mjs";
import { parseArgs } from "./helpers/arg-parser.mjs";

export const Master = function (ast, origNode, args) {
  const mArgs = parseArgs(args);
  console.log("Master directive", mArgs);
  const wait = mArgs.wait?.values().next().value || "wait";

  removeDirective("master", ast, origNode);

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
            if (nomp_get_thread_id() === 0) {
                ${generate(origNode)}
            }
        }s
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
