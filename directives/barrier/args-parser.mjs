import * as acorn from "acorn";
import * as acornWalk from "acorn-walk";

export function parseBarrierArgs(args) {
  if (!args) {
    return "default_barrier";
  }

  let barrierName = "default_barrier";

  try {
    let argAst = acorn.parse(args, {
      ecmaVersion: "latest",
      sourceType: "module",
    });

    acornWalk.simple(argAst, {
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "name") {
          if (node.arguments.length !== 1) {
            console.warn("Barrier name() must have exactly one argument");
            return;
          }

          const arg = node.arguments[0];
          if (arg.type === "Literal" && typeof arg.value === "string") {
            barrierName = arg.value;
          } else if (arg.type === "Identifier") {
            barrierName = arg.name;
          } else {
            console.warn(
              "Barrier name() argument must be a string or identifier"
            );
          }
        }
      },
    });
  } catch (e) {
    console.warn(`Error parsing barrier arguments: ${e.message}`);
  }

  return barrierName;
}
