import * as acorn from "acorn";
import * as acornWalk from "acorn-walk";

const replacements = {
  private: "priv",
  static: "stat",
};

export function parseArgs(args) {
  for (const [key, value] of Object.entries(replacements)) {
    args = args.replaceAll(key, value);
  }
  // console.log(args)
  let argAst = acorn.parse(args, {
    ecmaVersion: "latest",
    sourceType: "module",
  });

  let funcs = {};

  acornWalk.simple(argAst, {
    CallExpression(node) {
      funcs[node.callee.name] = new Set();
      for (const arg of node.arguments) {
        if (arg.type == "Identifier") {
          funcs[node.callee.name].add(arg.name);
        } else if (arg.type == "Literal") {
          funcs[node.callee.name].add(arg.value);
        } else {
          throw new Error(
            `${node.callee.name} must have references to variables or literals`
          );
        }
      }
    },
  });

  for (const [key, value] of Object.entries(replacements)) {
    if (funcs[value]) {
      funcs[key] = funcs[value];
      delete funcs[value];
    }
  }

  return funcs;
}
