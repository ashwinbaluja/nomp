import { Atomic } from "./directives/atomic.mjs";
import { Parallel } from "./directives/parallel.mjs";
import { Critical } from "./directives/critical.mjs";
import { Barrier } from "./directives/barrier.mjs";
import { For } from "./directives/for.mjs";
import { Single } from "./directives/single.mjs";
import { Master } from "./directives/master.mjs";

// const Parallel = function (fn, args) {
//   console.log ('Parallel function reached, args:', args);
//   return fn ();
// };

const ForEach = function (fn, args) {
  console.log("ForEach function reached, args:", args);
  return fn();
};

const Sections = function (fn, args) {
  console.log("Sections function reached, args:", args);
  return fn();
};

const Task = function (fn, args) {
  console.log("Task function reached, args:", args);
  return fn();
};

const TaskWait = function (fn, args) {
  console.log("Taskwait function reached, args:", args);
  return fn();
};

const Flush = function (fn, args) {
  console.log("Flush function reached, args:", args);
  return fn();
};

export const Directives = {
  parallel: Parallel,
  for: For,
  foreach: ForEach,
  sections: Sections,
  single: Single,
  master: Master,
  critical: Critical,
  atomic: Atomic,
  barrier: Barrier,
  task: Task,
  taskwait: TaskWait,
  flush: Flush,
};

// export const parallel = function (fn) {
//   let ast = acorn.parse ('' + fn, {
//     ecmaVersion: 'latest',
//     sourceType: 'module',
//   });
//   acornWalk.simple (ast, {
//     ExpressionStatement (node) {
//       console.log ('Expression Statement: ', node);
//     },
//     BlockStatement (node) {
//       console.log ('Block Statement: ', node);
//     },
//   });

//   console.log (generate (ast), '!');

//   return fn ();
// };
