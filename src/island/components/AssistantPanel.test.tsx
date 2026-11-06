import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, looksLikeModel } from "./AssistantPanel";

describe("assistant markdown", () => {
  it("renders bold, code and lists without raw HTML", () => {
    const html = renderToStaticMarkup(<Markdown text={"**Hi** `x`\n- one\n2. two\n<script>"} />);
    expect(html).toContain("<b>Hi</b>");
    expect(html).toContain("<code");
    expect(html).toContain("•");
    expect(html).toContain("2.");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("model ids", () => {
  it("rejects names, accepts real ids", () => {
    expect(looksLikeModel("Prince")).toBe(false);
    expect(looksLikeModel("my model")).toBe(false);
    expect(looksLikeModel("gemini-2.5-flash")).toBe(true);
    expect(looksLikeModel("gpt-4o-mini")).toBe(true);
    expect(looksLikeModel("llama3.2:3b")).toBe(true);
    expect(looksLikeModel("claude-haiku-5-5")).toBe(true);
  });
});
