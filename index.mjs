import * as acorn from "acorn";
import * as acornWalk from "acorn-walk";
import { Directives } from "./directives.mjs";
import { generate } from "astring";
import { buildSync } from "esbuild";
import * as path from "path";

// eslint-disable-next-line no-unused-vars
import * as v8 from "v8";
// eslint-disable-next-line no-unused-vars
import { sharedMemoryManager } from "./memory.mjs";
import * as fs from "fs";
// eslint-disable-next-line no-unused-vars
import { Worker } from "worker_threads";
import {
  parseCode,
  removeDirective,
} from "./directives/helpers/ast-helpers.mjs";

export const nomp_init = (fn) => {
  inner(fn);
};

const inner = async function (fn) {
  if (global["nomp"] !== undefined) {
    console.log("found global nomp, exiting");
    return;
  }
  global["nomp"] = true;

  const [f, funcs, fImport] = getCallingFile();
  var b64moduleData = "data:text/javascript;base64," + btoa(fImport);

  const fimp = await import(b64moduleData);
  for (const [key, value] of Object.entries(fimp)) {
    global[key] = value;
    if (typeof value === "function") {
      global[key] = value.bind(global);
    }
  }

  let ast = acorn.parse("" + fn, {
    ecmaVersion: "latest",
    sourceType: "module",
  });

  let toNompify = FindNodepenMPNodes(ast);
  const len = toNompify.length;

  let step = 0;

  while (toNompify.length > 0) {
    if (step > 10) {
      console.warn("Too many steps, breaking out of loop");
      break;
    }
    const { node, directive, args } = toNompify.pop();
    if (
      [
        "Atomic",
        "Parallel",
        "Critical",
        "Barrier",
        "For",
        "Single",
        "Master",
      ].indexOf(directive.name) === -1
    ) {
      console.warn(
        `Nompify step ${len - toNompify.length + 1}, directive: ${
          directive.name
        } is not a valid directive`
      );
      removeDirective(directive.name, ast, node);
      continue;
    }
    console.log(
      `NOMPify step ${step}, directive: ${directive.name}`
    );

    ast = directive(ast, node, args, f, funcs);

    const aststring = generate(ast)
    const stringed = directive.name + "\n" + "remaining: " + toNompify.map((e) => e.directive.name).join(", ") + "\n" + aststring;
    fs.writeFileSync(`out${step}.js`, stringed, "utf8");
    step++;

    toNompify = FindNodepenMPNodes(ast);
  }

  console.log("--- NOMPify complete ---");

  const stringed = generate(ast);
  fs.writeFileSync("out.js", stringed, "utf8");
  let p2 = eval(stringed)();
  const startTime = Date.now();
  await p2;
  console.log("Took ", Date.now() - startTime, "ms");
};

function getCallingFile() {
  const err = new Error();
  const stack = err.stack.split("\n");
  const callingFile = stack[4].trim().split(" ")[1];
  const regex = /import .+? "nomp";/gm;
  let f = fs
    .readFileSync(callingFile.replace("file://", "").split(":")[0], "utf8")
    .replaceAll(regex, "");

  f = "const nomp_init = (() => -1);\n" + f;

  let ast = acorn.parse(f, {
    ecmaVersion: "latest",
    sourceType: "module",
  });

  let identifiers = [];
  let importIdentifiers = [];

  acornWalk.ancestor(ast, {
    FunctionDeclaration(node, state, ancestors) {
      if (ancestors.length > 2) {
        return;
      }
      identifiers.push(node.id.name);
    },
    VariableDeclaration(node, state, ancestors) {
      if (ancestors.length > 2) {
        return;
      }
      if (node.declarations.length === 0) {
        return;
      }
      if (node.declarations[0].init === null) {
        return;
      }
      if (
        node.declarations[0].init.type !== "FunctionExpression" &&
        node.declarations[0].init.type !== "ArrowFunctionExpression"
      ) {
        return;
      }
      const name = node.declarations[0].id.name;
      identifiers.push(name);
    },
    ImportDeclaration(node, state, ancestors) {
      if (ancestors.length > 3) {
        return;
      }
      importIdentifiers = importIdentifiers.concat(
        node.specifiers.map((specifier) => specifier.local.name)
      );
    },
  });

  acornWalk.ancestor(ast, {
    ExpressionStatement(node, state, ancestors) {
      if (ancestors.length > 3) {
        return;
      }
      ancestors[ancestors.length - 2].body.splice(
        ancestors[ancestors.length - 2].body.indexOf(node),
        1
      );
    },
  });

  const ast2 = structuredClone(ast);
  const exportBlocks = identifiers
    .concat(importIdentifiers)
    .map((e) => parseCode("export " + e + ";"));
  ast2.body = ast.body.concat(exportBlocks);

  let esOut = buildSync({
    stdin: {
      contents: generate(ast2),
      resolveDir: path.dirname(
        callingFile.replace("file://", "").split(":")[0]
      ), // Crucial for relative imports
      sourcefile: path.basename(
        callingFile.replace("file://", "").split(":")[0]
      ),
      loader: "js",
    },
    bundle: true,
    treeShaking: false,
    write: false, // Don't write to disk, we want the output string
    format: "esm", // Or 'cjs', 'esm' depending on your eval environment
    sourcemap: "inline", // Helpful for debugging
    platform: "node", // Use 'browser' if you want to run in a browser context
  }).outputFiles[0].text;

  acornWalk.simple(ast, {
    ImportDeclaration(node) {
      const source = node.source.value;
      const specifiers = node.specifiers;

      if (specifiers.length === 0) {
        // Side-effect import: require(module)
        node.type = "ExpressionStatement";
        node.expression = {
          type: "CallExpression",
          callee: { type: "Identifier", name: "require" },
          arguments: [{ type: "Literal", value: source }],
        };
      } else if (
        specifiers.every(
          (specifier) => specifier.type === "ImportDefaultSpecifier"
        )
      ) {
        // Default import: const name = require(module)
        node.type = "VariableDeclaration";
        node.kind = "const";
        node.declarations = [
          {
            type: "VariableDeclarator",
            id: { type: "Identifier", name: specifiers[0].local.name },
            init: {
              type: "CallExpression",
              callee: { type: "Identifier", name: "require" },
              arguments: [{ type: "Literal", value: source }],
            },
          },
        ];
      } else {
        // Named imports or namespace import: const { a, b } = require(module)
        node.type = "VariableDeclaration";
        node.kind = "const";
        node.declarations = [
          {
            type: "VariableDeclarator",
            id: {
              type: "ObjectPattern",
              properties: specifiers.map((specifier) => ({
                type: "Property",
                method: false,
                shorthand:
                  specifier.type === "ImportSpecifier" &&
                  specifier.imported.name === specifier.local.name,
                key: { type: "Identifier", name: specifier.imported.name },
                value: { type: "Identifier", name: specifier.local.name },
                kind: "init",
              })),
            },
            init: {
              type: "CallExpression",
              callee: { type: "Identifier", name: "require" },
              arguments: [{ type: "Literal", value: source }],
            },
          },
        ];
      }
    },
  });

  // add modules to identifiers
  acornWalk.ancestor(ast, {
    CallExpression(node, state, ancestors) {
      if (node.callee.type !== "Identifier") {
        return;
      }
      if (node.callee.name !== "require") {
        return;
      }
      if (node.arguments.length === 0) {
        return;
      }
      if (node.arguments[0].type !== "Literal") {
        return;
      }

      const name = ancestors[ancestors.length - 2].id.name;
      identifiers.push(name);
    },
  });

  f = generate(ast);

  return [
    f +
      `[${identifiers
        .slice(1)
        .map((e) => `("${e}", ${e})`)
        .join(", ")}];`,
    identifiers.slice(1),
    esOut,
  ];
}

function FindNodepenMPNodes(ast) {
  let toNompify = [];

  acornWalk.full(ast, (node) => {
    if (node.type !== "ExpressionStatement") {
      return;
    }
    if (node.expression.type !== "Literal") {
      return;
    }
    // found a string sitting alone
    if (node.expression.value.indexOf("nomp") !== 0) {
      return;
    }
    // found a nomp!
    const lit = node.expression.value.split(" ");
    const directive = Directives[lit[1]];
    if (directive == undefined) {
      return;
    }
    // found a valid nomp directive!
    let parentNode;

    acornWalk.ancestor(ast, {
      ExpressionStatement(node2, state, ancestors) {
        if (node2 == node) {
          parentNode = ancestors[ancestors.length - 2];
        }
      },
    });

    const nextNode = parentNode.body[parentNode.body.indexOf(node) + 1];

    // const found = acornWalk.findNodeAfter(ast, node.end);
    if (nextNode === null) {
      console.log(directive.name, " directive found, but no next node found!");
      return;
    }

    if (nextNode === undefined) {
      console.log(directive.name, " directive found, but no next node found!");
    }
    // the next node is a one of the possible options!
    toNompify.push({
      node: nextNode,
      directive: directive,
      args: lit.slice(2).join(";"),
    });
  });


  // reorder such that parallel directive is first
  toNompify.sort((a, b) => {
    if (a.directive.name === "Parallel") return -1;
    if (b.directive.name === "Parallel") return 1;
    return 0;
  });

  return toNompify;
}
