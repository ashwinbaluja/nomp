class SharedMemoryManager {
  constructor() {
    this.nextIndex = 0;
    this.buffers = new Map();
    this.sharedArrayBuffer = new SharedArrayBuffer(1024 * 4);
    this.sharedMemory = new Int32Array(this.sharedArrayBuffer);

    this.serializedArrayBuffer = new SharedArrayBuffer(1024 * 1024);
    this.serializedDataView = new Uint8Array(this.serializedArrayBuffer);
    this.nextSerializedOffset = 0;

    this.sizesArrayBuffer = new SharedArrayBuffer(1024 * 4);
    this.sizesView = new Int32Array(this.sizesArrayBuffer);
    this.nextSizeIndex = 0;

    this.locks = new Map();

    this.barriers = new Map();
    this.barrierIndex = 0;
    this.numBarriers = 2;

    this.serializedVarMap = new Map();
  }

  allocateInt(
    varName,
    initialValue = 0,
    type = "int32",
    size = 1,
    isShared = false
  ) {
    const index = this.nextIndex;
    this.nextIndex += size;

    if (this.nextIndex > this.sharedMemory.length) {
      this._expandIntBuffer();
    }

    const info = {
      index,
      type,
      size,
      isShared,
    };
    this.buffers.set(varName, info);

    if (type === "array") {
      if (Array.isArray(initialValue)) {
        for (let i = 0; i < initialValue.length && i < size; i++) {
          this.sharedMemory[index + i] = initialValue[i];
        }
      }
    } else {
      this.sharedMemory[index] = initialValue;
    }

    return info;
  }

  _expandIntBuffer() {
    const newSize = this.sharedMemory.length * 2;
    const newBuffer = new SharedArrayBuffer(newSize * 4);
    const newView = new Int32Array(newBuffer);

    for (let i = 0; i < this.sharedMemory.length; i++) {
      newView[i] = this.sharedMemory[i];
    }

    this.sharedArrayBuffer = newBuffer;
    this.sharedMemory = newView;
  }

  _expandSerializedBuffer() {
    const newSize = this.serializedDataView.length * 2;
    const newBuffer = new SharedArrayBuffer(newSize);
    const newView = new Uint8Array(newBuffer);

    for (let i = 0; i < this.serializedDataView.length; i++) {
      newView[i] = this.serializedDataView[i];
    }

    this.serializedArrayBuffer = newBuffer;
    this.serializedDataView = newView;
  }

  getVariableInfo(varName) {
    return this.buffers.get(varName);
  }

  getSerializedVarInfo(varName) {
    return this.serializedVarMap.get(varName);
  }

  setupSerializedVariable(varName, serializedData, maxSize) {
    if (this.serializedVarMap.has(varName)) {
      const info = this.serializedVarMap.get(varName);

      if (serializedData.length > info.maxSize) {
        throw new Error(
          `Serialized data for '${varName}' exceeds allocated maxSize (${serializedData.length} > ${info.maxSize})`
        );
      }

      for (let i = 0; i < serializedData.length; i++) {
        this.serializedDataView[info.offset + i] = serializedData[i];
      }

      this.sizesView[info.sizeIndex] = serializedData.length;

      return info;
    }

    const offset = this.nextSerializedOffset;
    const sizeIndex = this.nextSizeIndex;

    if (offset + maxSize > this.serializedDataView.length) {
      while (offset + maxSize > this.serializedDataView.length) {
        this._expandSerializedBuffer();
      }
    }

    const info = {
      offset,
      sizeIndex,
      maxSize,
      type: "serialized",
    };

    for (let i = 0; i < serializedData.length; i++) {
      this.serializedDataView[offset + i] = serializedData[i];
    }

    this.sizesView[sizeIndex] = serializedData.length;

    this.serializedVarMap.set(varName, info);
    this.nextSerializedOffset += maxSize;
    this.nextSizeIndex++;

    return info;
  }

  readSerializedVariable(varName) {
    const v8 = require("v8");
    const info = this.serializedVarMap.get(varName);

    if (!info) {
      throw new Error(`No serialized variable named '${varName}'`);
    }

    const currentSize = this.sizesView[info.sizeIndex];
    const dataSlice = new Uint8Array(
      this.serializedArrayBuffer,
      info.offset,
      currentSize
    );

    return v8.deserialize(dataSlice);
  }

  writeSerializedVariable(varName, value) {
    const v8 = require("v8");
    const info = this.serializedVarMap.get(varName);

    if (!info) {
      throw new Error(`No serialized variable named '${varName}'`);
    }

    const serialized = v8.serialize(value);

    if (serialized.length > info.maxSize) {
      throw new Error(
        `Serialized data for '${varName}' exceeds allocated maxSize (${serialized.length} > ${info.maxSize})`
      );
    }

    for (let i = 0; i < serialized.length; i++) {
      this.serializedDataView[info.offset + i] = serialized[i];
    }

    Atomics.store(this.sizesView, info.sizeIndex, serialized.length);

    return value;
  }

  getBufferInfo() {
    return {
      mainBuffer: this.sharedArrayBuffer,
      serializedBuffer: this.serializedArrayBuffer,
      sizesBuffer: this.sizesArrayBuffer,
      intMap: this.buffers,
      serializedMap: this.serializedVarMap,
      locks: this.locks,
      barriers: this.barriers,
    };
  }

  allocateLock(lockName) {
    if (this.locks.has(lockName)) {
      console.warn(`Lock '${lockName}' already exists. Reusing existing lock.`);
      return this.locks.get(lockName);
    }

    const lockInfo = this.allocateInt(
      `__lock_${lockName}__`,
      0,
      "int32",
      1,
      true
    );

    this.locks.set(lockName, lockInfo);
    console.log(
      `[NOMP] Allocated lock '${lockName}' at index ${lockInfo.index}`
    );

    return lockInfo;
  }

  getLock(lockName) {
    if (!this.locks.has(lockName)) {
      return null;
    }
    return this.locks.get(lockName);
  }

  allocateBarrier(barrierName) {
    const barrierNum = this.barrierIndex % this.numBarriers;
    this.barrierIndex = (this.barrierIndex + 1) % this.numBarriers;

    const barrierKey = `barrier_${barrierNum}`;

    const counterIndex = this.nextIndex++;
    const generationIndex = this.nextIndex++;

    if (this.nextIndex > this.sharedMemory.length) {
      this._expandIntBuffer();
    }

    this.sharedMemory[counterIndex] = 0;
    this.sharedMemory[generationIndex] = 0;

    const barrierInfo = {
      counterIndex,
      generationIndex,
      name: barrierName,
    };

    this.barriers.set(barrierKey, barrierInfo);

    return barrierInfo;
  }

  getCurrentBarrierNumber() {
    return (this.barrierIndex + this.numBarriers - 1) % this.numBarriers;
  }

  shareVariable(varName, value, type = "int32") {
    if (this.buffers.has(varName)) {
      return this.buffers.get(varName);
    }

    if (type === "array" && Array.isArray(value)) {
      return this.allocateInt(varName, value, type, value.length, true);
    } else {
      return this.allocateInt(varName, value, type, 1, true);
    }
  }
}

export const sharedMemoryManager = new SharedMemoryManager();
