/* OoFind domain toolkit (pure functions, no DOM, no network).
 *
 *  - parseDomain / formatDomain: Python-literal domain text <-> JSON list
 *  - toTree / fromTree: prefix-notation domain <-> {group, leaf, not} tree
 *  - operatorsFor / compileCondition / describeLeaf: field-type aware conditions
 *  - datePreset / dateRangeDomain: date filters in the browser's time zone
 *  - rankFields: picks the fields worth showing as visual filters
 *  - explainTree: turns per-node match results into a human explanation
 */
(function (root) {
  "use strict";

  class ParseError extends Error {
    constructor(message, pos) {
      super(message);
      this.name = "ParseError";
      this.pos = pos;
    }
  }

  // ---------------------------------------------------------------------------
  // Python literal parser (enough for domains: str, num, bool, None, list, tuple, uid)
  const ESCAPES = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"' };

  function tokenize(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === "#") { while (i < src.length && src[i] !== "\n") i++; continue; }
      const start = i;
      if (/[A-Za-z_]/.test(c)) {
        while (i < src.length && /\w/.test(src[i])) i++;
        out.push({ t: "ident", v: src.slice(start, i), pos: start });
      } else if (/\d/.test(c) || (c === "." && /\d/.test(src[i + 1] || ""))) {
        const m = /^(?:\d[\d_]*)?(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?/.exec(src.slice(i));
        const text = m[0] || c;
        i += text.length;
        out.push({ t: "num", v: Number(text.replace(/_/g, "")), pos: start });
      } else if (c === "'" || c === '"') {
        i++;
        let s = "";
        for (;;) {
          if (i >= src.length || src[i] === "\n") throw new ParseError("Unterminated string", start);
          const ch = src[i];
          if (ch === c) { i++; break; }
          if (ch === "\\" && i + 1 < src.length) {
            const n = src[i + 1];
            s += n in ESCAPES ? ESCAPES[n] : n;
            i += 2;
            continue;
          }
          s += ch;
          i++;
        }
        out.push({ t: "str", v: s, pos: start });
      } else if ("()[],-".includes(c)) {
        out.push({ t: c, v: c, pos: start });
        i++;
      } else {
        throw new ParseError(`Unexpected character "${c}"`, start);
      }
    }
    out.push({ t: "eof", v: "", pos: src.length });
    return out;
  }

  function describeTok(tok) {
    if (tok.t === "eof") return "end of input";
    if (tok.t === "str") return `string ${JSON.stringify(tok.v)}`;
    return `"${tok.v}"`;
  }

  function parseLiteral(src, vars = {}) {
    const toks = tokenize(src);
    let i = 0;
    const peek = () => toks[i];
    const next = () => toks[i++];
    const expect = (t) => {
      const tok = next();
      if (tok.t !== t) throw new ParseError(`Expected "${t}" but found ${describeTok(tok)}`, tok.pos);
      return tok;
    };
    function seq(close) {
      const items = [];
      while (peek().t !== close) {
        items.push(value());
        if (peek().t === ",") next();
        else break;
      }
      expect(close);
      return items;
    }
    function value() {
      const tok = next();
      switch (tok.t) {
        case "str": return tok.v;
        case "num": return tok.v;
        case "-": {
          const v = value();
          if (typeof v !== "number") throw new ParseError('"-" must be followed by a number', tok.pos);
          return -v;
        }
        case "[": return seq("]");
        case "(": {
          if (peek().t === ")") { next(); return []; }
          const first = value();
          if (peek().t === ")") { next(); return first; }
          expect(",");
          return [first, ...seq(")")];
        }
        case "ident":
          if (tok.v === "True" || tok.v === "true") return true;
          if (tok.v === "False" || tok.v === "false") return false;
          if (tok.v === "None" || tok.v === "null") return null;
          if (Object.prototype.hasOwnProperty.call(vars, tok.v)) return vars[tok.v];
          throw new ParseError(`Unknown name "${tok.v}": only literals${Object.keys(vars).length ? ` and ${Object.keys(vars).join(", ")}` : ""} are allowed`, tok.pos);
        default:
          throw new ParseError(`Expected a value but found ${describeTok(tok)}`, tok.pos);
      }
    }
    const v = value();
    if (peek().t !== "eof") throw new ParseError(`Unexpected ${describeTok(peek())}`, peek().pos);
    return v;
  }

  const LOGIC = new Set(["&", "|", "!"]);

  function isLeaf(x) {
    return Array.isArray(x) && x.length === 3 && typeof x[0] === "string" && typeof x[1] === "string";
  }

  /** Check structure: returns the domain or throws ParseError. */
  function validateDomain(domain) {
    if (!Array.isArray(domain)) throw new ParseError("A domain must be a list", 0);
    // Terms still expected; top-level terms are implicitly AND-ed, so 0 just opens a new one.
    let need = 1;
    domain.forEach((item, idx) => {
      if (need === 0) need = 1;
      if (item === "&" || item === "|") need += 1;
      else if (item === "!") need += 0;
      else if (isLeaf(item) || isTrueFalseLeaf(item)) need -= 1;
      else throw new ParseError(`Item ${idx + 1} is not a condition: ${pyRepr(item)}`, 0);
    });
    if (domain.length && need > 0) {
      throw new ParseError(`"${domain.filter((d) => LOGIC.has(d)).pop()}" is missing ${need} operand(s)`, 0);
    }
    return domain;
  }

  function isTrueFalseLeaf(x) {
    return Array.isArray(x) && x.length === 3 && (x[0] === 1 || x[0] === 0) && x[1] === "=" && (x[2] === 1 || x[2] === 0);
  }

  function parseDomain(src, vars) {
    if (!src || !src.trim()) return [];
    const v = parseLiteral(src, vars);
    return validateDomain(v);
  }

  // ---------------------------------------------------------------------------
  // Python repr
  function pyStr(s) {
    const q = s.includes("'") && !s.includes('"') ? '"' : "'";
    let out = q;
    for (const ch of s) {
      if (ch === "\\") out += "\\\\";
      else if (ch === q) out += "\\" + q;
      else if (ch === "\n") out += "\\n";
      else if (ch === "\t") out += "\\t";
      else out += ch;
    }
    return out + q;
  }

  function pyRepr(v) {
    if (v === null || v === undefined) return "None";
    if (v === true) return "True";
    if (v === false) return "False";
    if (typeof v === "number") return String(v);
    if (typeof v === "string") return pyStr(v);
    if (Array.isArray(v)) return `[${v.map(pyRepr).join(", ")}]`;
    return `{${Object.entries(v).map(([k, x]) => `${pyStr(k)}: ${pyRepr(x)}`).join(", ")}}`;
  }

  function leafRepr(leaf) {
    return `(${pyRepr(leaf[0])}, ${pyRepr(leaf[1])}, ${pyRepr(leaf[2])})`;
  }

  /** Python text, one term per line (indented by nesting) when it doesn't fit on one line. */
  function formatDomain(domain) {
    if (!domain.length) return "[]";
    const terms = domain.map((t) => (Array.isArray(t) ? leafRepr(t) : pyStr(t)));
    const flat = `[${terms.join(", ")}]`;
    if (flat.length <= 72) return flat;
    // indent operands under their operator
    const lines = [];
    const stack = [];
    for (let k = 0; k < domain.length; k++) {
      const depth = stack.length;
      lines.push("    ".repeat(depth + 1) + terms[k] + ",");
      if (stack.length) stack[stack.length - 1]--;
      if (domain[k] === "&" || domain[k] === "|") stack.push(2);
      else if (domain[k] === "!") stack.push(1);
      while (stack.length && stack[stack.length - 1] === 0) stack.pop();
    }
    return `[\n${lines.join("\n")}\n]`;
  }

  // ---------------------------------------------------------------------------
  // Tree <-> prefix domain
  //   group: {type: "group", op: "&" | "|", children: [...]}
  //   leaf:  {type: "leaf", leaf: [path, op, value]}
  //   not:   {type: "not", child}
  function toTree(domain) {
    validateDomain(domain);
    let i = 0;
    function node() {
      const t = domain[i++];
      if (t === "&" || t === "|") {
        const a = node();
        const b = node();
        return { type: "group", op: t, children: [a, b] };
      }
      if (t === "!") return { type: "not", child: node() };
      return { type: "leaf", leaf: [t[0], t[1], t[2]] };
    }
    const tops = [];
    while (i < domain.length) tops.push(node());
    const tree = tops.length === 1 && tops[0].type === "group" ? tops[0] : { type: "group", op: "&", children: tops };
    return flatten(tree);
  }

  /** Merge nested groups with the same operator: (a & (b & c)) -> &(a, b, c). */
  function flatten(n) {
    if (n.type === "not") return { type: "not", child: flatten(n.child) };
    if (n.type !== "group") return n;
    const children = [];
    for (const c of n.children.map(flatten)) {
      if (c.type === "group" && c.op === n.op) children.push(...c.children);
      else children.push(c);
    }
    return { type: "group", op: n.op, children };
  }

  function fromTree(n) {
    if (!n) return [];
    if (n.type === "leaf") return [n.leaf.slice()];
    if (n.type === "not") {
      const inner = fromTree(n.child);
      return inner.length ? ["!", ...inner] : [];
    }
    const parts = n.children.map(fromTree).filter((d) => d.length);
    if (!parts.length) return [];
    const out = [];
    for (let k = 0; k < parts.length - 1; k++) out.push(n.op);
    for (const p of parts) out.push(...p);
    return out;
  }

  /** AND of several domains (empty ones ignored). */
  function andDomains(...domains) {
    const parts = domains.filter((d) => d && d.length);
    if (!parts.length) return [];
    if (parts.length === 1) return parts[0].slice();
    return fromTree(flatten({ type: "group", op: "&", children: parts.map(toTree) }));
  }

  function orDomains(...domains) {
    const parts = domains.filter((d) => d && d.length);
    if (!parts.length) return [];
    if (parts.length === 1) return parts[0].slice();
    return fromTree(flatten({ type: "group", op: "|", children: parts.map(toTree) }));
  }

  // ---------------------------------------------------------------------------
  // Operators per field type
  const RELATIONAL = new Set(["many2one", "many2many", "one2many", "many2one_reference"]);
  const NUMERIC = new Set(["integer", "float", "monetary"]);
  const DATES = new Set(["date", "datetime"]);
  const TEXT = new Set(["char", "text", "html"]);

  // kind: what value input the operator needs
  const OPS = {
    ilike: { label: "contains", kind: "text" },
    "not ilike": { label: "does not contain", kind: "text" },
    "=": { label: "is equal to", kind: "one" },
    "!=": { label: "is not equal to", kind: "one" },
    in: { label: "is in", kind: "many" },
    "not in": { label: "is not in", kind: "many" },
    ">": { label: "greater than", kind: "one" },
    ">=": { label: "at least", kind: "one" },
    "<": { label: "less than", kind: "one" },
    "<=": { label: "at most", kind: "one" },
    between: { label: "is between", kind: "range" },
    set: { label: "is set", kind: "none" },
    not_set: { label: "is not set", kind: "none" },
    is_true: { label: "is true", kind: "none" },
    is_false: { label: "is false", kind: "none" },
    within: { label: "is within", kind: "preset" },
    "=like": { label: "matches (=like)", kind: "text" },
    "=ilike": { label: "matches (=ilike)", kind: "text" },
    like: { label: "contains (case-sensitive)", kind: "text" },
    "not like": { label: "does not contain (case-sensitive)", kind: "text" },
    child_of: { label: "is child of", kind: "many" },
    parent_of: { label: "is parent of", kind: "many" },
    any: { label: "matches any", kind: "domain" },
    "not any": { label: "matches none", kind: "domain" },
  };

  function operatorsFor(type) {
    if (type === "boolean") return ["is_true", "is_false"];
    if (type === "selection") return ["in", "not in", "=", "!=", "set", "not_set"];
    if (RELATIONAL.has(type)) return ["in", "not in", "ilike", "not ilike", "set", "not_set"];
    if (NUMERIC.has(type)) return ["=", "!=", ">", ">=", "<", "<=", "between", "set", "not_set"];
    if (DATES.has(type)) return ["within", "between", ">", "<", "=", "set", "not_set"];
    if (TEXT.has(type)) return ["ilike", "not ilike", "=", "!=", "set", "not_set"];
    return ["=", "!=", "set", "not_set"];
  }

  function opLabel(op) {
    return (OPS[op] && OPS[op].label) || op;
  }

  function opKind(op) {
    return (OPS[op] && OPS[op].kind) || "one";
  }

  /**
   * Builder condition -> domain list.
   * cond: {path, type, op, value, value2}
   * Dates: value/value2 are "YYYY-MM-DD" (local); `within` uses value = preset key.
   */
  function compileCondition(cond, now) {
    const { path, type, op } = cond;
    let { value, value2 } = cond;
    if (!path) return [];
    switch (op) {
      case "set": return [[path, "!=", false]];
      case "not_set": return [[path, "=", false]];
      case "is_true": return [[path, "=", true]];
      case "is_false": return [[path, "=", false]];
      case "within": {
        const r = datePreset(value, now);
        return r ? dateRangeDomain(path, type, r.from, r.to) : [];
      }
      case "between":
        if (DATES.has(type)) return dateRangeDomain(path, type, value || null, value2 || null);
        return andDomains(
          value === "" || value === null || value === undefined ? [] : [[path, ">=", Number(value)]],
          value2 === "" || value2 === null || value2 === undefined ? [] : [[path, "<=", Number(value2)]],
        );
      case "in":
      case "not in":
        return [[path, op, Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]]];
      default:
        if (DATES.has(type) && typeof value === "string" && value) {
          if (type === "datetime") {
            // a day boundary in local time
            if (op === "=") return dateRangeDomain(path, type, value, value);
            if (op === ">" || op === ">=") return [[path, ">=", toUtc(addDays(value, op === ">" ? 1 : 0))]];
            return [[path, "<", toUtc(addDays(value, op === "<=" ? 1 : 0))]];
          }
          return [[path, op, value]];
        }
        if (NUMERIC.has(type)) value = value === "" || value === null ? 0 : Number(value);
        return [[path, op, value === undefined ? false : value]];
    }
  }

  /** Domain leaf -> builder condition (best effort, for editing a parsed domain). */
  function leafToCondition(leaf, type) {
    const [path, op, value] = leaf;
    if (op === "!=" && value === false) return { path, type, op: "set" };
    if (op === "=" && value === false) return { path, type, op: type === "boolean" ? "is_false" : "not_set" };
    if (op === "=" && value === true && type === "boolean") return { path, type, op: "is_true" };
    if (op === "!=" && value === true && type === "boolean") return { path, type, op: "is_false" };
    if (type === "datetime" && typeof value === "string") {
      return { path, type, op: op === ">=" ? ">" : op === "<=" ? "<" : op, value: value.slice(0, 10), raw: true };
    }
    return { path, type, op, value };
  }

  // ---------------------------------------------------------------------------
  // Dates (local time zone of the browser, like the Odoo web client)
  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function ymd(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function parseYmd(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(s, n) {
    const d = parseYmd(s);
    d.setDate(d.getDate() + n);
    return ymd(d);
  }

  /** Local "YYYY-MM-DD" midnight -> UTC "YYYY-MM-DD HH:MM:SS". */
  function toUtc(s) {
    const d = parseYmd(s);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }

  const PRESETS = [
    ["today", "Today"],
    ["yesterday", "Yesterday"],
    ["this_week", "This week"],
    ["last_7", "Last 7 days"],
    ["this_month", "This month"],
    ["last_month", "Last month"],
    ["last_30", "Last 30 days"],
    ["this_quarter", "This quarter"],
    ["last_quarter", "Last quarter"],
    ["this_year", "This year"],
    ["last_year", "Last year"],
    ["last_365", "Last 365 days"],
    ["next_7", "Next 7 days"],
    ["next_30", "Next 30 days"],
    ["past", "Before today"],
    ["future", "After today"],
  ];

  /** Inclusive local date range {from, to} ("YYYY-MM-DD" or null for open ends). */
  function datePreset(key, now = new Date()) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const t = ymd(today);
    const day = (n) => addDays(t, n);
    const y = today.getFullYear();
    const m = today.getMonth();
    const q = Math.floor(m / 3);
    const monthStart = (yy, mm) => ymd(new Date(yy, mm, 1));
    const monthEnd = (yy, mm) => ymd(new Date(yy, mm + 1, 0));
    switch (key) {
      case "today": return { from: t, to: t };
      case "yesterday": return { from: day(-1), to: day(-1) };
      case "this_week": {
        const dow = (today.getDay() + 6) % 7; // Monday first
        return { from: day(-dow), to: day(6 - dow) };
      }
      case "last_7": return { from: day(-6), to: t };
      case "this_month": return { from: monthStart(y, m), to: monthEnd(y, m) };
      case "last_month": return { from: monthStart(y, m - 1), to: monthEnd(y, m - 1) };
      case "last_30": return { from: day(-29), to: t };
      case "this_quarter": return { from: monthStart(y, q * 3), to: monthEnd(y, q * 3 + 2) };
      case "last_quarter": return { from: monthStart(y, q * 3 - 3), to: monthEnd(y, q * 3 - 1) };
      case "this_year": return { from: `${y}-01-01`, to: `${y}-12-31` };
      case "last_year": return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
      case "last_365": return { from: day(-364), to: t };
      case "next_7": return { from: t, to: day(6) };
      case "next_30": return { from: t, to: day(29) };
      case "past": return { from: null, to: day(-1) };
      case "future": return { from: day(1), to: null };
      default: return null;
    }
  }

  function presetLabel(key) {
    const hit = PRESETS.find(([k]) => k === key);
    return hit ? hit[1] : key;
  }

  /** Inclusive local range -> domain. Datetimes are converted to UTC day boundaries. */
  function dateRangeDomain(path, type, from, to) {
    const leaves = [];
    if (type === "datetime") {
      if (from) leaves.push([path, ">=", toUtc(from)]);
      if (to) leaves.push([path, "<", toUtc(addDays(to, 1))]);
    } else {
      if (from) leaves.push([path, ">=", from]);
      if (to) leaves.push([path, "<=", to]);
    }
    return andDomains(...leaves.map((l) => [l]));
  }

  // ---------------------------------------------------------------------------
  // Fields worth a visual filter
  const SKIP = new Set([
    "id", "display_name", "__last_update", "write_date", "write_uid", "create_uid",
    "message_ids", "message_follower_ids", "message_partner_ids", "message_attachment_count",
    "message_has_error", "message_has_error_counter", "message_has_sms_error", "message_is_follower",
    "message_needaction", "message_needaction_counter", "message_main_attachment_id",
    "website_message_ids", "activity_ids", "activity_exception_decoration", "activity_exception_icon",
    "activity_type_icon", "activity_calendar_event_id", "rating_ids", "access_token", "access_url",
    "access_warning", "has_message", "my_activity_date_deadline", "color", "sequence",
    "company_currency_id", "currency_rate", "duration_tracking", "properties",
  ]);
  const PRIORITY = { state: 50, stage_id: 48, status: 45, type: 30, move_type: 40, payment_state: 40, invoice_status: 35, user_id: 30, partner_id: 30, company_id: 10, team_id: 25, tag_ids: 25, categ_id: 25, active: 15, priority: 20, activity_state: 20 };
  const TYPE_SCORE = { selection: 22, many2one: 18, boolean: 10, date: 14, datetime: 13, many2many: 12, monetary: 9, float: 6, integer: 6, char: 2 };

  /**
   * fields: fields_get result; searchFields: names used in the search view.
   * Returns [{name, field, score}] sorted, most useful first.
   */
  function rankFields(fields, searchFields = []) {
    const inView = new Set(searchFields);
    const out = [];
    for (const [name, field] of Object.entries(fields)) {
      if (SKIP.has(name) || name.startsWith("message_") || name.startsWith("website_message")) continue;
      const base = TYPE_SCORE[field.type];
      if (base === undefined) continue;
      if (field.searchable === false) continue;
      const groupable = field.groupable !== undefined ? field.groupable : field.store !== false;
      // counts need groupable fields; text and numbers can still be filtered without them
      if (!groupable && !["char", "monetary", "float", "integer", "date", "datetime"].includes(field.type)) continue;
      let score = base + (PRIORITY[name] || 0);
      if (inView.has(name)) score += 25;
      if (field.type === "char" && !inView.has(name)) continue;
      if (field.type === "many2one" && /^(currency_id|create_uid|write_uid)$/.test(name)) score -= 15;
      if (field.type === "boolean" && name !== "active" && !inView.has(name)) score -= 6;
      if (/^x_/.test(name)) score += 2;
      out.push({ name, field, score });
    }
    out.sort((a, b) => b.score - a.score || (a.field.string || a.name).localeCompare(b.field.string || b.name));
    return out;
  }

  // ---------------------------------------------------------------------------
  // Explain: numbered tree + verdict propagation
  /** Assigns ids and returns {tree, nodes: [{id, domain}]} for every leaf and group. */
  function explainPlan(domain) {
    const tree = toTree(domain);
    const nodes = [];
    let seq = 0;
    (function visit(n) {
      n.id = ++seq;
      nodes.push({ id: n.id, domain: fromTree(n) });
      if (n.type === "group") n.children.forEach(visit);
      else if (n.type === "not") visit(n.child);
    })(tree);
    return { tree, nodes };
  }

  /**
   * results: {id: true|false|null}. Returns the leaves that explain a mismatch:
   * the failing children of failing AND groups, every child of a failing OR.
   */
  function explainCauses(tree, results) {
    const causes = [];
    (function visit(n) {
      if (results[n.id] !== false) return;
      if (n.type === "leaf") { causes.push(n); return; }
      if (n.type === "not") { causes.push(n); return; }
      if (n.op === "&") n.children.forEach(visit);
      else causes.push(n);
    })(tree);
    return causes;
  }

  // ---------------------------------------------------------------------------
  // Human text
  function fieldLabel(path, fieldsByModel, model) {
    // fieldsByModel: {model: fields_get}; walks dotted paths
    const parts = path.split(".");
    const labels = [];
    let current = model;
    for (const p of parts) {
      const f = current && fieldsByModel[current] && fieldsByModel[current][p];
      labels.push(f ? f.string || p : p);
      current = f && f.relation;
    }
    return labels.join(" › ");
  }

  function fieldAt(path, fieldsByModel, model) {
    let current = model;
    let f = null;
    for (const p of path.split(".")) {
      f = current && fieldsByModel[current] && fieldsByModel[current][p];
      if (!f) return null;
      current = f.relation;
    }
    return f;
  }

  function valueText(value, field, names = {}) {
    if (value === false || value === null) return "not set";
    if (value === true) return "true";
    if (Array.isArray(value)) return value.map((v) => valueText(v, field, names)).join(", ") || "nothing";
    if (field && field.type === "selection" && Array.isArray(field.selection)) {
      const hit = field.selection.find(([k]) => k === value);
      if (hit) return hit[1];
    }
    if (field && field.relation && typeof value === "number" && names[`${field.relation},${value}`]) {
      return names[`${field.relation},${value}`];
    }
    if (field && field.relation && typeof value === "number") return `#${value}`;
    return typeof value === "string" ? `"${value}"` : String(value);
  }

  const SHORT = {
    "=": "=", "!=": "≠", ">": ">", ">=": "≥", "<": "<", "<=": "≤", in: "is", "not in": "is not",
    ilike: "contains", "not ilike": "doesn't contain", like: "contains", "not like": "doesn't contain",
    "=like": "matches", "=ilike": "matches", child_of: "child of", parent_of: "parent of", any: "has any", "not any": "has none",
  };

  function describeLeaf(leaf, fieldsByModel, model, names) {
    const [path, op, value] = leaf;
    if (isTrueFalseLeaf(leaf)) return path === 1 ? "Always true" : "Always false";
    const f = fieldAt(path, fieldsByModel, model);
    const label = fieldLabel(path, fieldsByModel, model);
    if (op === "!=" && value === false) return `${label} is set`;
    if (op === "=" && value === false) return f && f.type === "boolean" ? `${label} is false` : `${label} is not set`;
    if (op === "=" && value === true) return `${label} is true`;
    if ((op === "any" || op === "not any") && Array.isArray(value)) {
      return `${label} ${SHORT[op]}${value.length ? " matching " + formatDomain(value) : ""}`;
    }
    const sep = op === "in" || op === "not in" ? (Array.isArray(value) && value.length > 1 ? " one of " : " ") : " ";
    return `${label} ${SHORT[op] || op}${sep}${valueText(value, f, names)}`;
  }

  function describeDomain(domain, fieldsByModel, model, names) {
    if (!domain.length) return "All records";
    const tree = toTree(domain);
    return (function text(n, top) {
      if (n.type === "leaf") return describeLeaf(n.leaf, fieldsByModel, model, names);
      if (n.type === "not") return `not (${text(n.child)})`;
      const inner = n.children.map((c) => text(c)).join(n.op === "&" ? " and " : " or ");
      return top || n.children.length < 2 ? inner : `(${inner})`;
    })(tree, true);
  }

  root.OofindDomain = {
    ParseError, parseLiteral, parseDomain, validateDomain, formatDomain, pyRepr, leafRepr,
    toTree, fromTree, flatten, andDomains, orDomains, isLeaf,
    operatorsFor, opLabel, opKind, compileCondition, leafToCondition, OPS,
    datePreset, presetLabel, PRESETS, dateRangeDomain, toUtc, addDays, ymd,
    rankFields, explainPlan, explainCauses,
    fieldLabel, fieldAt, valueText, describeLeaf, describeDomain,
    RELATIONAL, NUMERIC, DATES, TEXT,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
