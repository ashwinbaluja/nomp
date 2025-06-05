import * as acorn from "acorn-loose";
import * as acornWalk from "acorn-walk";

export function parseCode(code) {
  const ast = acorn.parse(code, {
    ecmaVersion: "latest",
    sourceType: "module",
    allowReturnOutsideFunction: true,
  });
  return ast.body[0];
}

export function parseExpression(code) {
  const wrapped = `(${code})`;
  const ast = acorn.parse(wrapped, {
    ecmaVersion: "latest",
    sourceType: "module",
  });
  return ast.body[0].expression;
}

export function removeDirective(directiveName, ast, origNode) {
  acornWalk.ancestor(ast, {
    ExpressionStatement(node, state, ancestors) {
      if (node.expression.type !== "Literal") {
        return;
      }
      if (node.expression.value.indexOf(`nomp ${directiveName}`) !== 0) {
        return;
      }

      let parentNode;
      acornWalk.ancestor(ast, {
        ExpressionStatement(node2, state, ancestors) {
          if (node2 === node) {
            parentNode = ancestors[ancestors.length - 2];
          }
        },
      });

      let nodeAfter = parentNode.body[parentNode.body.indexOf(node) + 1];

      if (nodeAfter === undefined) {
        return;
      }
      if (nodeAfter == origNode) {
        ancestors[ancestors.length - 2].body.splice(
          ancestors[ancestors.length - 2].body.indexOf(node),
          1
        );
      }
    },
  });
}
