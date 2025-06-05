import { generate } from "astring";
import * as acornWalk from "acorn-walk";
import { sharedMemoryManager } from "../memory.mjs";
import {
  parseCode,
  parseExpression,
  removeDirective,
} from "./helpers/ast-helpers.mjs";
import { parseArgs } from "./helpers/arg-parser.mjs";

export const For = function (ast, origNode, args) {
  const operations = new Set(["sum", "nestedsum", "max", "min"]);
  const fArgs = parseArgs(args);
  const schedule = fArgs.schedule?.values().next().value || "static";

  let toAggregate = {};
  let aggNames = {};
  if (fArgs.agg) {
    for (const k of [...fArgs.agg]) {
      let operation = k.split("_")[0];
      if (!operations.has(operation)) operation = "sum";
      const variable = k.split("_").slice(1).join("_");
      toAggregate[variable] = operation;
      aggNames[
        variable
      ] = `nomp_agg_${operation}_${variable}_${origNode.start}`;
    }
  }

  const forVariable = origNode.init.declarations[0];
  let loopBody = origNode.body;

  let newLoopBody = structuredClone(loopBody);

  let forParent;

  removeDirective("for", ast, origNode);

  acornWalk.ancestor(ast, {
    ForStatement(node, state, ancestors) {
      if (node === origNode) {
        forParent = ancestors[ancestors.length - 2];
        return;
      }
    },
  });

  if (Object.keys(toAggregate).length > 0) {
    acornWalk.simple(newLoopBody, {
      Identifier(node) {
        if (node.name in toAggregate) {
          Object.assign(node, {
            type: "Identifier",
            name: aggNames[node.name],
          });
        }
      },
    });

    Object.entries(aggNames).forEach(([variable, newName]) => {
      console.log(
        parseCode(`{
          const start = performance.now();
          const ${newName} = ${variable};
          console.log("Deserialized ${newName} in " + (performance.now() - start) + "ms");
        }`)
      );
    });

    Object.entries(aggNames).forEach(([variable, newName]) => {
      parseCode(`{
          const start = performance.now();
          const ${newName} = ${variable});
          console.log("Deserialized ${newName} in " + (performance.now() - start) + "ms");
        }`).body.forEach((node) => {
        forParent.body.splice(forParent.body.indexOf(origNode), 0, node);
      });
    });

    Object.entries(toAggregate).forEach(([variable, operation]) => {
      if (operation == "sum") {
        forParent.body.splice(
          forParent.body.indexOf(origNode) + 1,
          0,
          parseCode(`
            {
              "nomp critical name(agg_${operation}_${variable}_${origNode.start})"
              {
                ${variable} += ${aggNames[variable]};
              }
            }
          `)
        );
      } else if (operation == "nestedsum") {
        forParent.body.splice(
          forParent.body.indexOf(origNode) + 1,
          0,
          parseCode(`
            {
              'nomp barrier name(agg_${operation}_${variable}_${origNode.start})'
              {
                const start = Date.now();

                const sumNested = (tensor1, tensor2) => {
                  const rows1 = tensor1.length;
                  const cols = tensor1[0].length;

                  let result = Array.from({ length: rows1 }, () =>
                    new Float64Array(cols).fill(0)
                  );

                  for (let i = 0; i < rows1; i++) {
                    for (let j = 0; j < cols; j++) {
                      result[i][j] = tensor1[i][j] + tensor2[i][j];
                    }
                  }
                  return result;
                };

                'nomp critical name(op_${aggNames[variable]})'
                {
                  console.log('entered critical', Date.now() - start, 'ms');

                  ${variable} = sumNested(${aggNames[variable]}, ${aggNames[variable]});
                  console.log('finished critical', Date.now() - start, 'ms');
                }
                console.log("Nested sum for ${variable} completed in ms", (Date.now() - start));

              }
            }
          `)
        );
      }
    });
  }

  let parentBlock;

  acornWalk.ancestor(ast, {
    ForStatement(node, state, ancestors) {
      if (node === origNode) {
        parentBlock = ancestors[ancestors.length - 2];
        return;
      }
    },
  });

  if (schedule == "dynamic") {
    const atomicInt = sharedMemoryManager.allocateInt(
      "__lock_for__",
      null,
      "int32",
      1,
      true
    );

    const newLoopVar =
      "nomp_for_prev_value__" + loopBody.start + "_" + loopBody.end;

    parentBlock.body.splice(parentBlock.body.indexOf(origNode), 0, {
      type: "VariableDeclaration",
      kind: "let",
      declarations: [
        {
          type: "VariableDeclarator",
          id: {
            type: "Identifier",
            name: newLoopVar,
          },
        },
      ],
    });

    const wrappedBlock = parseCode(`
      {
        let oldValue = Atomics.compareExchange(
          nomp_shared_mem,
          ${atomicInt.index},
          ${newLoopVar},
          ${forVariable.id.name}
        );
        if (oldValue !== ${newLoopVar}) {
          ${newLoopVar} = ${forVariable.id.name};
          continue;
        }
        ${newLoopVar} = ${forVariable.id.name};
        ${generate(newLoopBody)}

      }
    `);

    Object.assign(loopBody, wrappedBlock);
  } else {
    const origNode2 = structuredClone(origNode);
    const entriesName = `nomp_loop_${loopBody.start}_${loopBody.end}_indicies`;
    origNode2.body = parseExpression(`
        ${entriesName}.push(${forVariable.id.name});
    `);

    const entriesDeclaration = {
      type: "VariableDeclaration",
      kind: "let",
      declarations: [
        {
          type: "VariableDeclarator",
          id: {
            type: "Identifier",
            name: entriesName,
          },
          init: {
            type: "ArrayExpression",
            elements: [],
          },
        },
      ],
    };

    parentBlock.body.splice(
      parentBlock.body.indexOf(origNode),
      0,
      entriesDeclaration
    );

    const sectionFindingBlock = parseCode(`
      {
        ${generate(origNode2)}
        let result = [];
        const ${entriesName}_length = ${entriesName}.length;
        for (let i = nomp_num_threads; i > 0; i--) {
            result.push(${entriesName}.splice(0, Math.ceil(${entriesName}_length / i)));
        };
        ${entriesName} = result[nomp_get_thread_id()];

        console.log(Date.now() - startTime, "Thread " + nomp_get_thread_id() + " has entries: ", ${entriesName});
      }
    `);

    parentBlock.body.splice(
      parentBlock.body.indexOf(origNode),
      0,
      sectionFindingBlock
    );

    newLoopBody.body.push(
      parseCode(`{
      }`)
    );

    const newFor = parseCode(`
      for (let nomp_iterator_${loopBody.start}_${
      loopBody.end
    } = 0; nomp_iterator_${loopBody.start}_${
      loopBody.end
    } < ${entriesName}.length; nomp_iterator_${loopBody.start}_${
      loopBody.end
    }++) {
        ${forVariable.id.name} = ${entriesName}[nomp_iterator_${
      loopBody.start
    }_${loopBody.end}];
          forVariable.id.name
        });
        ${generate(newLoopBody)}
      }
    `);

    parentBlock.body.splice(parentBlock.body.indexOf(origNode), 1, newFor);
  }

  return ast;
};
