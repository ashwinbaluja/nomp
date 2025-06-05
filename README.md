# NOMP

OpenMP for Node.js

## Usage

Import the NOMP initialization function:

```javascript
import { nomp_init } from 'nomp';
```

Use NOMP directives in your code as string literals prefixed with 'nomp':

```javascript
nomp_init(async () => {
  let sum = 0;
  
  "nomp parallel"
  {
    "nomp atomic"
    sum += 1;
  }
  
  console.log(sum); // Will print the number of threads
});
```

## Supported Directives

### Parallel

Creates a team of threads to execute a code block in parallel:

```javascript
"nomp parallel num_threads(4) shared(x) private(y)"
{
  // Parallel code here
}
```

### Examples

```javascript
// Parallel for loop
"nomp for"
for(let i = 0; i < n; i++) {
  compute(i);
}

// Atomic operations
"nomp atomic"
counter += 1;

// Critical sections
"nomp critical"
{
  sharedResource.update();
}

// Thread synchronization
"nomp barrier"
{
  // All threads synchronize here
}
```

### Advanced Usage

```javascript
// Parallel with thread count and shared vars
"nomp parallel num_threads(4) shared(x)"
{
  // Parallel code with 4 threads
}

// Parallel loop with scheduling
"nomp for schedule(dynamic)"
for(let i = 0; i < n; i++) {
  heavyComputation(i);
}
```

## Quick Start

```javascript
import { nomp_init } from 'nomp';

nomp_init(async () => {
  "nomp parallel"
  {
    // Your parallel code here
  }
});
```
