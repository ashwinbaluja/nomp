import * as acornWalk from "acorn-walk";
import { parseCode } from "../helpers/ast-helpers.mjs";

export function insertThreadsDeclaration(origNode, numThreads) {
  if (typeof numThreads !== "string") {
    origNode.body.unshift(
      parseCode(`{ const nomp_num_threads = ${numThreads}; }`).body[0]
    );
  }
}

export function replaceTMPWithSourceFile(ast, srcFile) {
  acornWalk.ancestor(ast, {
    Identifier(node) {
      if (node.name === "TMP") {
        Object.assign(node, { type: "Literal", value: srcFile });
      }
    },
  });
}

export function replaceOriginalNode(ast, origNode, transformedCode) {
  acornWalk.simple(ast, {
    BlockStatement(node) {
      if (node === origNode) {
        Object.assign(node, transformedCode);
      }
    },
  });
}

export function addPromiseHandling(ast, origNode, runtimeFinalizationCode) {
  if (
    ast.body[0] &&
    ast.body[0].type === "ExpressionStatement" &&
    ast.body[0].expression.type === "ArrowFunctionExpression"
  ) {
    ast.body[0].expression.body.body.unshift(
      parseCode(`let nomp_return_promise;`)
    );
    ast.body[0].expression.body.body.unshift(
      parseCode(`let nomp_return_status = false;`)
    );
    if (runtimeFinalizationCode) {
      ast.body[0].expression.body.body.splice(
        ast.body[0].expression.body.body.indexOf(origNode) + 1,
        0,
        parseCode(runtimeFinalizationCode)
      );
    }
    ast.body[0].expression.body.body.splice(
      ast.body[0].expression.body.body.indexOf(origNode) + 1,
      0,
      parseCode(`await nomp_return_promise;`)
    );
    // ast.body[0].expression.body.body.push(
    //   parseCode(`await nomp_return_promise;`)
    // );
  } else if (ast.body[0] && ast.body[0].type === "FunctionDeclaration") {
    ast.body[0].body.body.unshift(parseCode(`let nomp_return_promise;`));
    ast.body[0].body.body.push(parseCode(`${runtimeFinalizationCode}`));
    if (runtimeFinalizationCode) {
      ast.body[0].body.body.splice(
        ast.body[0].body.body.indexOf(origNode) + 1,
        0,
        parseCode(runtimeFinalizationCode)
      );
    }
    ast.body[0].body.body.splice(
      ast.body[0].body.body.indexOf(origNode) + 1,
      0,
      parseCode(`await nomp_return_promise;`)
    );

    // ast.body[0].body.body.push(parseCode(`await nomp_return_promise;`));
  }
}
