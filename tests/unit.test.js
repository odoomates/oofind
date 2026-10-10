import { test, eq, finish } from "./harness.js";

const D = globalThis.OofindDomain;

function throws(fn, pattern) {
    try {
        fn();
    } catch (e) {
        if (!(e instanceof D.ParseError)) throw new Error(`expected ParseError, got ${e}`);
        if (pattern && !pattern.test(e.message)) throw new Error(`message "${e.message}" doesn't match ${pattern}`);
        return;
    }
    throw new Error("expected an error");
}

test("parse python domains", () => {
    eq(D.parseDomain("[('state', '=', 'sale'), ('amount', '>', -1.5)]"), [["state", "=", "sale"], ["amount", ">", -1.5]]);
    eq(D.parseDomain(`['|', ("a", "in", [1, 2]), ('b', '=', False)]`), ["|", ["a", "in", [1, 2]], ["b", "=", false]]);
    eq(D.parseDomain('[["x", "!=", null], ["y", "=", true]]'), [["x", "!=", null], ["y", "=", true]], "json style");
    eq(D.parseDomain("[('user_id', '=', uid)]", { uid: 7 }), [["user_id", "=", 7]]);
    eq(D.parseDomain(""), []);
    eq(D.parseDomain("[(1, '=', 1)]"), [[1, "=", 1]]);
});

test("parse errors", () => {
    throws(() => D.parseDomain("[('a', '=', 1]"), /Expected "\)"/);
    throws(() => D.parseDomain("[('a', '=', ,)]"), /Expected a value/);
    throws(() => D.parseDomain("[('a', '=', foo)]"), /Unknown name "foo"/);
    throws(() => D.parseDomain("['|', ('a', '=', 1)]"), /missing 1 operand/);
    throws(() => D.parseDomain("[('a', '=')]"), /not a condition/);
    throws(() => D.parseDomain("('a', '=', 1)"), /must be a list|not a condition/);
});

test("format domain", () => {
    eq(D.formatDomain([]), "[]");
    eq(D.formatDomain([["state", "=", "sale"]]), "[('state', '=', 'sale')]");
    eq(D.formatDomain([["name", "ilike", "it's"]]), `[('name', 'ilike', "it's")]`);
    const long = ["|", ["partner_id.country_id.code", "=", "KW"], ["partner_id.country_id.code", "=", "SA"], ["amount_untaxed", ">", 100]];
    eq(D.formatDomain(long), "[\n    '|',\n        ('partner_id.country_id.code', '=', 'KW'),\n        ('partner_id.country_id.code', '=', 'SA'),\n    ('amount_untaxed', '>', 100),\n]");
    eq(D.parseDomain(D.formatDomain(long)), long, "round trip");
});

test("tree round trip, implicit and, flattening", () => {
    const dom = [["a", "=", 1], "|", ["b", "=", 2], ["c", "=", 3]];
    const tree = D.toTree(dom);
    eq(tree.op, "&");
    eq(tree.children.length, 2);
    eq(tree.children[1].op, "|");
    eq(D.fromTree(tree), ["&", ["a", "=", 1], "|", ["b", "=", 2], ["c", "=", 3]]);
    const nested = D.toTree(["&", "&", ["a", "=", 1], ["b", "=", 2], ["c", "=", 3]]);
    eq(nested.children.length, 3, "same-op groups merge");
    eq(D.fromTree(D.toTree(["!", ["a", "=", 1]])), ["!", ["a", "=", 1]]);
    eq(D.fromTree({ type: "group", op: "|", children: [] }), []);
});

test("and / or domains", () => {
    eq(D.andDomains([], [["a", "=", 1]]), [["a", "=", 1]]);
    eq(D.andDomains([["a", "=", 1]], ["|", ["b", "=", 1], ["c", "=", 1]]), ["&", ["a", "=", 1], "|", ["b", "=", 1], ["c", "=", 1]]);
    eq(D.orDomains([["a", "=", 1]], [["b", "=", 1]], [["c", "=", 1]]), ["|", "|", ["a", "=", 1], ["b", "=", 1], ["c", "=", 1]]);
});

test("operators depend on the field type", () => {
    eq(D.operatorsFor("boolean"), ["is_true", "is_false"]);
    eq(D.operatorsFor("many2one").includes("in"), true);
    eq(D.operatorsFor("monetary").includes("between"), true);
    eq(D.operatorsFor("datetime")[0], "within");
});

test("compile conditions", () => {
    eq(D.compileCondition({ path: "email", type: "char", op: "set" }), [["email", "!=", false]]);
    eq(D.compileCondition({ path: "active", type: "boolean", op: "is_false" }), [["active", "=", false]]);
    eq(D.compileCondition({ path: "state", type: "selection", op: "in", value: ["sale", "done"] }), [["state", "in", ["sale", "done"]]]);
    eq(D.compileCondition({ path: "amount", type: "monetary", op: ">", value: "100" }), [["amount", ">", 100]]);
    eq(D.compileCondition({ path: "amount", type: "float", op: "between", value: "1", value2: "" }), [["amount", ">=", 1]]);
    eq(D.compileCondition({ path: "d", type: "date", op: "between", value: "2026-01-01", value2: "2026-01-31" }), ["&", ["d", ">=", "2026-01-01"], ["d", "<=", "2026-01-31"]]);
    const now = new Date(2026, 9, 9, 15, 0, 0); // 9 Oct 2026, local
    eq(D.compileCondition({ path: "d", type: "date", op: "within", value: "this_month" }, now), ["&", ["d", ">=", "2026-10-01"], ["d", "<=", "2026-10-31"]]);
    const dt = D.compileCondition({ path: "t", type: "datetime", op: "within", value: "today" }, now);
    eq(dt[1][2], D.toUtc("2026-10-09"));
    eq(dt[2], ["t", "<", D.toUtc("2026-10-10")]);
});

test("date presets", () => {
    const now = new Date(2026, 9, 9); // Friday
    eq(D.datePreset("this_week", now), { from: "2026-10-05", to: "2026-10-11" });
    eq(D.datePreset("last_month", now), { from: "2026-09-01", to: "2026-09-30" });
    eq(D.datePreset("this_quarter", now), { from: "2026-10-01", to: "2026-12-31" });
    eq(D.datePreset("last_quarter", now), { from: "2026-07-01", to: "2026-09-30" });
    eq(D.datePreset("last_month", new Date(2026, 0, 15)), { from: "2025-12-01", to: "2025-12-31" }, "year wrap");
    eq(D.datePreset("last_7", now), { from: "2026-10-03", to: "2026-10-09" });
    eq(D.datePreset("past", now), { from: null, to: "2026-10-08" });
});

test("rank fields", () => {
    const fields = {
        id: { type: "integer", string: "ID" },
        name: { type: "char", string: "Name" },
        state: { type: "selection", string: "Status", groupable: true },
        partner_id: { type: "many2one", string: "Customer", relation: "res.partner", groupable: true },
        note: { type: "html", string: "Note" },
        message_ids: { type: "one2many", string: "Messages" },
        amount_total: { type: "monetary", string: "Total", groupable: true },
        is_x: { type: "boolean", string: "X", groupable: true },
        computed: { type: "selection", string: "C", groupable: false },
    };
    const names = D.rankFields(fields, ["name"]).map((r) => r.name);
    eq(names[0], "state");
    eq(names.includes("name"), true, "char in search view kept");
    eq(names.includes("id") || names.includes("note") || names.includes("message_ids") || names.includes("computed"), false);
});

test("explain plan and causes", () => {
    const dom = [["state", "=", "sale"], ["amount", ">", 100], "|", ["c", "=", "KW"], ["c", "=", "SA"]];
    const { tree, nodes } = D.explainPlan(dom);
    eq(nodes.length, 6, "root + 2 leaves + or + 2 leaves");
    eq(nodes[0].domain, D.fromTree(D.toTree(dom)));
    const results = { 1: false, 2: true, 3: false, 4: false, 5: false, 6: false };
    const causes = D.explainCauses(tree, results);
    eq(causes.map((c) => c.id), [3, 4], "failing leaf + failing OR group");
});

test("describe", () => {
    const fields = {
        "sale.order": {
            state: { type: "selection", string: "Status", selection: [["draft", "Quotation"], ["sale", "Sales Order"]] },
            partner_id: { type: "many2one", string: "Customer", relation: "res.partner" },
            amount: { type: "monetary", string: "Amount" },
        },
        "res.partner": { country_id: { type: "many2one", string: "Country", relation: "res.country" } },
    };
    eq(D.describeLeaf(["state", "in", ["draft", "sale"]], fields, "sale.order"), "Status is one of Quotation, Sales Order");
    eq(D.describeLeaf(["partner_id.country_id", "=", 5], fields, "sale.order", { "res.country,5": "Kuwait" }), "Customer › Country = Kuwait");
    eq(D.describeLeaf(["amount", "!=", false], fields, "sale.order"), "Amount is set");
    eq(D.describeDomain(["|", ["state", "=", "draft"], ["amount", ">", 5], ["amount", "<", 9]], fields, "sale.order"),
        "(Status = Quotation or Amount > 5) and Amount < 9");
});

finish();
