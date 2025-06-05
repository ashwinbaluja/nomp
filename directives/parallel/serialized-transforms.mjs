import * as acornWalk from "acorn-walk";
import { parseExpression } from "../helpers/ast-helpers.mjs";
import { generate } from "astring";

export function transformSharedVariableAccesses(node, sharedVarsMap) {
  const sharedVarsSet = new Set(sharedVarsMap.keys());
  const directives = new Set();
  acornWalk.ancestor(node, {
    ExpressionStatement(node) {
      if (
        node.expression &&
        node.expression.type === "Literal" &&
        typeof node.expression.value === "string"
      ) {
        directives.add(node);
      }
    },
  });

  acornWalk.ancestor(node, {
    AssignmentExpression(node) {
      if (
        node.left.type === "Identifier" &&
        sharedVarsSet.has(node.left.name)
      ) {
        const varName = node.left.name;
        const valueExpr = generate(node.right);

        if (node.operator === "=") {
          Object.assign(
            node,
            parseExpression(
              `sharedMemoryManager.writeSerializedVariable("${varName}", ${valueExpr})`
            )
          );
        } else {
          const operator = node.operator.slice(0, -1);
          Object.assign(
            node,
            parseExpression(`
            (() => {
              const currentVal = sharedMemoryManager.readSerializedVariable("${varName}");
              const newVal = currentVal ${operator} (${valueExpr});
              return sharedMemoryManager.writeSerializedVariable("${varName}", newVal);
            })()
            `)
          );
        }
      } else if (
        node.left.type === "MemberExpression" &&
        node.left.object.type === "Identifier" &&
        sharedVarsSet.has(node.left.object.name)
      ) {
        const objName = node.left.object.name;
        const propAccessExpr = node.left.computed
          ? `[${generate(node.left.property)}]`
          : `.${node.left.property.name}`;

        let valueExpr = generate(node.right);

        if (node.operator === "=") {
          const propExpr = node.left.computed
            ? generate(node.left.property)
            : null;

          Object.assign(
            node,
            parseExpression(`
            (() => {
              const tempObj = sharedMemoryManager.readSerializedVariable("${objName}");
              ${propExpr ? `const propKey = ${propExpr};` : ""}
              const newValue = ${valueExpr};
              tempObj${
                node.left.computed ? "[propKey]" : propAccessExpr
              } = newValue;
              return sharedMemoryManager.writeSerializedVariable("${objName}", tempObj);
            })()
          `)
          );
        } else {
          const operator = node.operator.slice(0, -1);
          const propExpr = node.left.computed
            ? generate(node.left.property)
            : null;

          Object.assign(
            node,
            parseExpression(`
            (() => {
              const tempObj = sharedMemoryManager.readSerializedVariable("${objName}");
              ${propExpr ? `const propKey = ${propExpr};` : ""}
              const currentValue = tempObj${
                node.left.computed ? "[propKey]" : propAccessExpr
              };
              const newValue = currentValue ${operator} (${valueExpr});
              tempObj${
                node.left.computed ? "[propKey]" : propAccessExpr
              } = newValue;
              return sharedMemoryManager.writeSerializedVariable("${objName}", tempObj);
            })()
          `)
          );
        }
      }
    },

    UpdateExpression(node) {
      if (
        node.argument.type === "Identifier" &&
        sharedVarsSet.has(node.argument.name)
      ) {
        const varName = node.argument.name;
        const prefix = node.prefix;
        const operator = node.operator;

        Object.assign(
          node,
          parseExpression(`
          (() => {
            const currentVal = sharedMemoryManager.readSerializedVariable("${varName}");
            const newVal = ${
              operator === "++" ? "currentVal + 1" : "currentVal - 1"
            };
            sharedMemoryManager.writeSerializedVariable("${varName}", newVal);
            return ${prefix ? "newVal" : "currentVal"};
          })()
        `)
        );
      } else if (
        node.argument.type === "MemberExpression" &&
        node.argument.object.type === "Identifier" &&
        sharedVarsSet.has(node.argument.object.name)
      ) {
        const objName = node.argument.object.name;
        const propAccessExpr = node.argument.computed
          ? `[${generate(node.argument.property)}]`
          : `.${node.argument.property.name}`;
        const prefix = node.prefix;
        const operator = node.operator;
        const propExpr = node.argument.computed
          ? generate(node.argument.property)
          : null;

        Object.assign(
          node,
          parseExpression(`
          (() => {
            const obj = sharedMemoryManager.readSerializedVariable("${objName}");
            ${propExpr ? `const propKey = ${propExpr};` : ""}
            const currentVal = obj${
              node.argument.computed ? "[propKey]" : propAccessExpr
            };
            const newVal = ${
              operator === "++" ? "currentVal + 1" : "currentVal - 1"
            };
            obj${
              node.argument.computed ? "[propKey]" : propAccessExpr
            } = newVal;
            sharedMemoryManager.writeSerializedVariable("${objName}", obj);
            return ${prefix ? "newVal" : "currentVal"};
          })()
        `)
        );
      }
    },
  });

  acornWalk.ancestor(node, {
    Identifier(node, state, ancestors) {
      if (ancestors.some((a) => directives.has(a))) return;

      if (!sharedVarsSet.has(node.name)) return;
      const parent = ancestors[ancestors.length - 2];
      if (!parent) return;

      if (parent.type === "VariableDeclarator" && parent.id === node) return;
      if (parent.type === "AssignmentExpression" && parent.left === node)
        return;
      if (parent.type === "Property" && parent.key === node && !parent.computed)
        return;

      if (
        (parent.type === "FunctionDeclaration" ||
          parent.type === "FunctionExpression") &&
        (parent.id === node || parent.params.includes(node))
      )
        return;
      if (
        parent.type === "ArrowFunctionExpression" &&
        parent.params.includes(node)
      )
        return;

      const grandparent = ancestors[ancestors.length - 3];
      if (
        parent.type === "MemberExpression" &&
        parent.object === node &&
        grandparent &&
        ((grandparent.type === "AssignmentExpression" &&
          grandparent.left === parent) ||
          (grandparent.type === "UpdateExpression" &&
            grandparent.argument === parent))
      ) {
        return;
      }

      Object.assign(
        node,
        parseExpression(
          `sharedMemoryManager.readSerializedVariable("${node.name}")`
        )
      );
    },
  });
}
