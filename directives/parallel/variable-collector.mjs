import * as acornWalk from "acorn-walk";

export function collectDefinedVariables(node) {
  const definedVars = new Set();
  acornWalk.simple(node, {
    VariableDeclaration(node) {
      node.declarations.forEach((decl) => {
        if (decl.id.type === "Identifier") {
          definedVars.add(decl.id.name);
        }
      });
    },
    FunctionDeclaration(node) {
      node.params.forEach((param) => {
        if (param.type === "Identifier") {
          definedVars.add(param.name);
        }
      });
    },
    FunctionExpression(node) {
      node.params.forEach((param) => {
        if (param.type === "Identifier") {
          definedVars.add(param.name);
        }
      });
    },
    ArrowFunctionExpression(node) {
      node.params.forEach((param) => {
        if (param.type === "Identifier") {
          definedVars.add(param.name);
        }
      });
    },
  });
  return definedVars;
}

export function collectUsedVariables(node) {
  const usedVars = new Set();
  acornWalk.ancestor(node, {
    Identifier(node, state, ancestors) {
      if (global[node.name] !== undefined) {
        return;
      }

      // Skip if this is a function parameter
      const parent = ancestors[ancestors.length - 2];
      if (parent) {
        // Skip function parameters
        if (
          (parent.type === "FunctionDeclaration" ||
            parent.type === "FunctionExpression" ||
            parent.type === "ArrowFunctionExpression") &&
          parent.params.includes(node)
        ) {
          return;
        }

        // Skip if this is a variable declaration
        if (parent.type === "VariableDeclarator" && parent.id === node) {
          return;
        }
      }

      usedVars.add(node.name);
    },
  });
  return usedVars;
}

export function collectSerializedVariables(ast, sharedVars) {
  let sharedVarInfo = new Map();

  acornWalk.ancestor(ast, {
    VariableDeclaration(node, state, ancestors) {
      for (const decl of node.declarations) {
        if (sharedVars.has(decl.id.name)) {
          sharedVarInfo.set(decl.id.name, {
            name: decl.id.name,
            declaration: node,
            ancestors: ancestors,
          });
        }
      }
    },
  });

  sharedVars.forEach((varName) => {
    if (!sharedVarInfo.has(varName)) {
      sharedVarInfo.set(varName, {
        name: varName,
        declaration: null,
        ancestors: null,
      });
    }
  });

  return sharedVarInfo;
}

export function removeSharedVariableDeclarations(origNode, sharedVars) {
  acornWalk.ancestor(origNode, {
    VariableDeclaration(node, state, ancestors) {
      const newDeclarations = node.declarations.filter((decl) => {
        if (decl.id.type === "Identifier" && sharedVars.has(decl.id.name)) {
          return false;
        }
        return true;
      });

      if (newDeclarations.length === 0) {
        const parentBlock = ancestors[ancestors.length - 2];
        if (
          parentBlock &&
          parentBlock.body &&
          Array.isArray(parentBlock.body)
        ) {
          const index = parentBlock.body.indexOf(node);
          if (index !== -1) {
            parentBlock.body.splice(index, 1);
          }
        }
      } else {
        node.declarations = newDeclarations;
      }
    },
  });
}
