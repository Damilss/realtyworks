// Registers the jest-dom matchers (e.g. toBeInTheDocument) and augments
// Vitest's `expect` types via module augmentation — no tsconfig change needed.
// React Testing Library sets IS_REACT_ACT_ENVIRONMENT itself on import.
import "@testing-library/jest-dom/vitest";
