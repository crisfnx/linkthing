// Testing Library unmounts after each test only when Vitest's globals are on;
// they aren't here, so components from one test would leak into the next.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);
