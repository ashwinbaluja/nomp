import { parseCode } from "../helpers/ast-helpers.mjs";
// eslint-disable-next-line no-unused-vars
import { generate } from "astring";

export function generateRuntimeInitialization(sharedVarInfo) {
  let snippets = [];
  sharedVarInfo.forEach((info, varName) => {
    const varNameLiteral = JSON.stringify(varName);
    snippets.push(`
      try {
        const _${varName}_value = ${varName};
        const _${varName}_serialized = v8.serialize(_${varName}_value);
        const _${varName}_maxSize = Math.max(128, _${varName}_serialized.length * 2, _${varName}_serialized.length + 1024);
        const _${varName}_info = sharedMemoryManager.setupSerializedVariable(
          ${varNameLiteral},
          _${varName}_serialized,
          _${varName}_maxSize
        );
        console.log(\`[NOMP] Setup serialized variable '${varName}' (size: \${_${varName}_serialized.length}, max: \${_${varName}_maxSize})\`);
      } catch (e) {
        console.error(\`[NOMP] Error setting up serialized variable '${varName}':\`, e);
      }
    `);
  });
  return snippets.join("\n");
}

// same as generateRunTimeInitialization but in reverse, to run after the parallel block
export function generateRuntimeFinalization(sharedVarInfo) {
  let snippets = [];
  sharedVarInfo.forEach((info, varName) => {
    snippets.push(`
      try {
          const {mainBuffer, serializedBuffer, sizesBuffer, intMap, serializedMap} = sharedMemoryManager.getBufferInfo();
          const sizesView = new Int32Array(sizesBuffer);
          const info = serializedMap.get("${varName}");
          const currentSize = sizesView[info.sizeIndex];
          const dataView = new Uint8Array(serializedBuffer, info.offset, currentSize);
          ${varName} = v8.deserialize(dataView);
      } catch (e) {
        console.error(\`[NOMP] Error finalizing variable '${varName}':\`, e);
      }
    `);
  });
  return snippets.join("\n");
}

export function generateParallelCode(
  threads,
  privateVariables,
  runtimeInitCode,
  origNodeCode,
  ids
) {
  return parseCode(`
    {
      ${runtimeInitCode == "" ? "" : runtimeInitCode}
      const { mainBuffer, serializedBuffer, sizesBuffer, intMap, serializedMap } = sharedMemoryManager.getBufferInfo();

      const nomp_f = (() => {
        // process.stdout.isTTY = true;
        const v8 = require('v8');
        const nomp_worker_data = require("worker_threads").workerData;
        const nomp_num_threads = nomp_worker_data.nomp_num_threads;
        global.sharedMemoryManager = {
          readSerializedVariable: (varName) => {
            const info = nomp_worker_data.serializedMap.get(varName);
            if (!info) throw new Error(\`No serialized variable named '\${varName}'\`);
            
            const sizesView = new Int32Array(nomp_worker_data.sizesBuffer);
            const currentSize = Atomics.load(sizesView, info.sizeIndex);
            
            let newArrayBuffer = new ArrayBuffer(currentSize);

            const dataView = new Uint8Array(
              newArrayBuffer,
              0,
              currentSize
            );

            dataView.set(
              new Uint8Array(nomp_worker_data.serializedBuffer, info.offset, currentSize)
            );
            
            return v8.deserialize(dataView);
          },
          
          writeSerializedVariable: (varName, value) => {
            const info = nomp_worker_data.serializedMap.get(varName);
            if (!info) throw new Error(\`No serialized variable named '\${varName}'\`);
            
            const serialized = v8.serialize(value);
            if (serialized.length > info.maxSize) {
              throw new Error(\`Serialized data for '\${varName}' exceeds allocated maxSize (\${serialized.length} > \${info.maxSize})\`);
            }
            
            const dataView = new Uint8Array(nomp_worker_data.serializedBuffer, info.offset, serialized.length);
            for (let i = 0; i < serialized.length; i++) {
              dataView[i] = serialized[i];
            }
            
            const sizesView = new Int32Array(nomp_worker_data.sizesBuffer);
            Atomics.store(sizesView, info.sizeIndex, serialized.length);
            
            return value;
          }
        };

        const nomp_shared_mem = new Int32Array(nomp_worker_data.mainBuffer);
        const nomp_mem_mapping = nomp_worker_data.intMap;

        const c = eval(nomp_worker_data.program);

        const names = ${JSON.stringify(ids)};
        for (let i = 0; i < c.length; i++) {
          global[names[i]] = c[i];
        };

        for (const [k, v] of Object.entries(nomp_worker_data.unsharedVariables)) {
          const orig = v8.serialize(v);
          var dst = new ArrayBuffer(orig.byteLength);
          var dataView = new Uint8Array(dst);
          dataView.set(new Uint8Array(orig));
          global[k] = v8.deserialize(dataView);
        }

        global["nomp_get_thread_id"] = () => nomp_worker_data.nomp_thread_id;

        ${origNodeCode}

        process.exit(0);
      });
      
      let workers = [];
      let promises = [];
      
      for (let nomp_iterator = 0; nomp_iterator < ${threads}; nomp_iterator++) {
        workers.push(new Worker(\`(\${nomp_f})()\`, {
          eval: true,
          workerData: {
            unsharedVariables: (()=>{
                const unshared = {};
                {
                ${Array.from(privateVariables)
                  .map((k) => {
                    console.log(k);
                    return `unshared["${k}"] = typeof ${k} !== 'undefined' ? ${k} : undefined;`;
                  })
                  .join(" ")}
                };
                return unshared;
            })(),
            nomp_thread_id: nomp_iterator,
            nomp_num_threads: ${threads},
            mainBuffer: mainBuffer,
            serializedBuffer: serializedBuffer,
            sizesBuffer: sizesBuffer,
            intMap: intMap,
            serializedMap: serializedMap,
            program: TMP,
          }
        }));
        
        promises.push(new Promise((resolve, reject) => {
          workers[nomp_iterator].on("exit", (code) => {
            if (code === 0) resolve();
            else reject(new Error(\`Worker stopped with exit code \${code}\`));
          });
          workers[nomp_iterator].on("error", reject);
        }));
      }
      
      nomp_return_promise = Promise.all(promises).then(() => {
        nomp_return_status = true;
      });
    }
  `);
}
