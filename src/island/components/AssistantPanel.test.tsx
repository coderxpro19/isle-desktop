import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./AssistantPanel";

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
