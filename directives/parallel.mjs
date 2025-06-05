import { removeDirective } from "./helpers/ast-helpers.mjs";
import { cpus } from "os";
import { generate } from "astring";

import {
  collectDefinedVariables,
  collectUsedVariables,
  collectSerializedVariables,
  removeSharedVariableDeclarations,
} from "./parallel/variable-collector.mjs";
import { transformSharedVariableAccesses } from "./parallel/serialized-transforms.mjs";
import {
  generateRuntimeInitialization,
  generateParallelCode,
  generateRuntimeFinalization,
} from "./parallel/code-generation.mjs";
import {
  insertThreadsDeclaration,
  replaceTMPWithSourceFile,
  replaceOriginalNode,
  addPromiseHandling,
} from "./parallel/ast-transforms.mjs";
import { parseArgs } from "./helpers/arg-parser.mjs";

const NOMP_DECLARATIONS = new Set([
  "nomp_num_threads",
  "nomp_get_thread_id",
  "nomp_worker_data",
  "nomp_f",
  "nomp_thread_id",
  "nomp_shared_mem",
  "nomp_return_promise",
  "nomp_mem_mapping",
]);

export const Parallel = function (ast, origNode, args, srcFile, ids) {
  const pArgs = parseArgs(args);

  const num_threads = pArgs?.num_threads.values().next().value || cpus().length;
  const sharedVariablesArg = pArgs?.shared || new Set();
  const privateVariables = pArgs?.private || new Set();

  const threadsVar =
    typeof num_threads !== "string" ? "nomp_num_threads" : num_threads;

  const definedVars = collectDefinedVariables(origNode);
  const usedVars = collectUsedVariables(origNode);

  const sharedVars = usedVars
    .difference(privateVariables)
    .difference(definedVars)
    .difference(NOMP_DECLARATIONS)
    .difference(
      new Set([
        "this",
        "let",
        "const",
        "var",
        "function",
        "class",
        "undefined",
        "null",
        "v8",
      ])
    )
    .difference(new Set(ids))
    .union(sharedVariablesArg);

  const sharedVarInfo = collectSerializedVariables(ast, sharedVars);

  removeSharedVariableDeclarations(origNode, sharedVars);
  transformSharedVariableAccesses(origNode, sharedVarInfo);

  const runtimeInitCode = generateRuntimeInitialization(sharedVarInfo);
  const runtimeFinalizationCode = generateRuntimeFinalization(sharedVarInfo);
  const origNodeCode = generate(origNode);
  const transformedCode = generateParallelCode(
    threadsVar,
    privateVariables,
    runtimeInitCode,
    origNodeCode,
    ids
  );

  replaceTMPWithSourceFile(transformedCode, srcFile);
  removeDirective("parallel", ast, origNode);
  replaceOriginalNode(ast, origNode, transformedCode);
  addPromiseHandling(ast, origNode, runtimeFinalizationCode);
  insertThreadsDeclaration(ast, num_threads);

  return ast;
};
