Comprehensive guidance for TypeScript's advanced type system: generics, conditional types, mapped types, template literal types, and utility types.

Reference files with full examples: `.agents/skills/typescript-advanced-types/references/`

## Generics

```typescript
function identity<T>(value: T): T { return value; }

// Constraints
interface HasLength { length: number; }
function logLength<T extends HasLength>(item: T): T { ... }

// Multiple params
function merge<T, U>(obj1: T, obj2: U): T & U { return { ...obj1, ...obj2 }; }
```

## Conditional Types

```typescript
type IsString<T> = T extends string ? true : false;

// Infer
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : never;

// Distributive
type ToArray<T> = T extends any ? T[] : never;
type StrOrNumArray = ToArray<string | number>; // string[] | number[]
```

## Mapped Types

```typescript
// Key remapping
type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};

// Filter by type
type PickByType<T, U> = {
  [K in keyof T as T[K] extends U ? K : never]: T[K];
};
```

## Template Literal Types

```typescript
type EventName = "click" | "focus" | "blur";
type EventHandler = `on${Capitalize<EventName>}`; // "onClick" | "onFocus" | "onBlur"

// Path building
type Path<T> = T extends object
  ? { [K in keyof T]: K extends string ? `${K}` | `${K}.${Path<T[K]>}` : never }[keyof T]
  : never;
```

## Built-in Utility Types

```typescript
Partial<T>          // all optional
Required<T>         // all required
Readonly<T>         // all readonly
Pick<T, K>          // select keys
Omit<T, K>          // remove keys
Exclude<T, U>       // exclude from union
Extract<T, U>       // extract from union
NonNullable<T>      // remove null/undefined
Record<K, T>        // object type
```

## Key Patterns

### Discriminated Unions (use for error handling and state machines)
```typescript
type AsyncState<T> =
  | { status: "success"; data: T }
  | { status: "error"; error: string }
  | { status: "loading" };
```

### Deep Readonly/Partial
```typescript
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object
    ? T[P] extends Function ? T[P] : DeepReadonly<T[P]>
    : T[P];
};
```

### Type Guards
```typescript
function isString(value: unknown): value is string {
  return typeof value === "string";
}
function isArrayOf<T>(value: unknown, guard: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(guard);
}
```

### Assertion Functions
```typescript
function assertIsString(value: unknown): asserts value is string {
  if (typeof value !== "string") throw new Error("Not a string");
}
```

### Infer Keyword
```typescript
type ElementType<T> = T extends (infer U)[] ? U : never;
type PromiseType<T> = T extends Promise<infer U> ? U : never;
```

## Best Practices

- `unknown` over `any`
- `interface` for object shapes (better error messages), `type` for unions/complex types
- Const assertions for literal types: `as const`
- Type guards over type assertions (`as`)
- `strict: true` + `noUncheckedIndexedAccess: true`

## Performance

- Avoid deeply nested conditional types
- Limit recursion depth in recursive types
- Cache complex type computations with type aliases
- Split unions > 100 members
