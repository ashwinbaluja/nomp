import * as acornWalk from "acorn-walk";
import { generate } from "astring";
import { sharedMemoryManager } from "../memory.mjs";
import { parseExpression, removeDirective } from "./helpers/ast-helpers.mjs";

function findVariableDeclaration(ast, varName) {
  let declaration = null;
  let initialValue = 0;

  acornWalk.ancestor(ast, {
    VariableDeclaration(node, state, ancestors) {
      if (!node.declarations || node.declarations.length === 0) {
        return;
      }
      if (node.declarations[0].id.name === varName) {
        initialValue = node.declarations[0].init.value;
        declaration = node.declarations[0];

        ancestors[ancestors.length - 2].body.splice(
          ancestors[ancestors.length - 2].body.indexOf(node),
          1
        );

        return { declaration, initialValue };
      }
    },
  });

  return { declaration, initialValue };
}

export const Atomic = function (ast, origNode) {
  if (origNode.type !== "ExpressionStatement") {
    console.warn("Atomic directive must be applied to an expression");
    return ast;
  }

  const expr = origNode.expression;
  if (expr.type !== "AssignmentExpression") {
    console.warn("Atomic directive must be applied to an assignment");
    return ast;
  }

  const varName = expr.left.name;
  let atomicInfo = sharedMemoryManager.getVariableInfo(varName);

  if (!atomicInfo) {
    const { declaration, initialValue } = findVariableDeclaration(ast, varName);
    if (!declaration) {
      console.warn(`No declaration found for atomic variable ${varName}`);
      return ast;
    }

    atomicInfo = sharedMemoryManager.allocateInt(varName, eval(initialValue));
  }

  console.log(atomicInfo, "ATOMICINFO FOR ", varName);

  const value = generate(expr.right);
  if (expr.operator === "+=") {
    Object.assign(
      expr,
      parseExpression(
        `Atomics.add(nomp_shared_mem, nomp_mem_mapping.get("${varName}").index, ${value})`
      )
    );
  } else if (expr.operator === "-=") {
    Object.assign(
      expr,
      parseExpression(
        `Atomics.sub(nomp_shared_mem, nomp_mem_mapping.get("${varName}").index, ${value})`
      )
    );
  } else if (expr.operator === "=") {
    Object.assign(
      expr,
      parseExpression(
        `Atomics.store(nomp_shared_mem, nomp_mem_mapping.get("${varName}").index, ${value})`
      )
    );
  } else {
    console.warn("Unsupported atomic operation:", expr.operator);
    return ast;
  }

  acornWalk.ancestor(ast, {
    Identifier(node) {
      if (node.name === varName && node !== expr.left) {
        Object.assign(
          node,
          parseExpression(
            `nomp_shared_mem[nomp_mem_mapping.get("${varName}").index]`
          )
        );
      }
    },
    ExpressionStatement(node) {
      if (node["expression"].left?.name === varName) {
        Object.assign(
          node["expression"].left,
          parseExpression(
            `nomp_shared_mem[nomp_mem_mapping.get("${varName}").index]`
          )
        );
      } else if (node["expression"].right?.name === varName) {
        Object.assign(
          node["expression"].right,
          parseExpression(
            `nomp_shared_mem[nomp_mem_mapping.get("${varName}").index]`
          )
        );
      }
    },
  });

  removeDirective("atomic", ast, origNode);

  return ast;
};
