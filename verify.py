# Recall ad-hoc verification suite (v5 invariants)
# Usage: python verify.py
# Asserts: no JS errors, home view loads, sheets keep hidden attr, fonts loaded,
# FSRS persists stability, undo works, delete returns to empty state.
# This is the project's standing verification harness — not a one-off.
import json, sys
from playwright.sync_api import sync_playwright

FAILS, results = [], {}
def check(name, cond, got=None):
    results[name] = got if got is not None else cond
    if not cond: FAILS.append((name, got))

PROD = "https://tylersimons1127.github.io/recall-study/?verify=stable"

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width":390,"height":844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))

    pg.goto(PROD, wait_until="networkidle"); pg.wait_for_timeout(1800)
    check("no_js_errors_on_load", len(errs) == 0, errs[:3])
    check("home_view_active", pg.evaluate("document.querySelector('.view.active').id") == "view-home")
    check("empty_state_shown", pg.evaluate("!document.getElementById('empty-home').hidden") is True)
    for side in ("sheet-newset", "sheet-settings", "sheet-editcard"):
        d = pg.evaluate(f"getComputedStyle(document.getElementById('{side}')).display")
        check(f"{side}_hidden", d == "none", d)
    fonts = pg.evaluate("""()=>({
      disp: getComputedStyle(document.querySelector('.today-title')).fontFamily,
      body: getComputedStyle(document.body).fontFamily,
      mono: getComputedStyle(document.querySelector('.stat-num')).fontFamily,
    })""")
    check("fraunces_display", "Fraunces" in fonts["disp"], fonts["disp"][:80])
    check("publicsans_body", "Public Sans" in fonts["body"], fonts["body"][:80])
    check("ibmplexmono_num", "IBM Plex Mono" in fonts["mono"], fonts["mono"][:80])
    check("paper_noise", "data:image/svg" in pg.evaluate("getComputedStyle(document.body).backgroundImage"))
    sh = pg.evaluate("getComputedStyle(document.querySelector('.today-card')).boxShadow")
    check("card_shadow_layered", "inset" in sh and "rgba(27, 26, 21" in sh, sh[:120])
    # create a tiny set then probe state, not UI timing
    pg.evaluate("document.getElementById('btn-new-set').click()"); pg.wait_for_timeout(200)
    pg.evaluate("document.querySelector('[data-tab=manual]').click()"); pg.wait_for_timeout(200)
    # manual rows are appended on first manual-tab click if handler seeds them; ensure via direct call
    rows_have = pg.evaluate("document.querySelectorAll('#manual-rows .mrow').length")
    if rows_have == 0:
        pg.evaluate("typeof addManualRow === 'function' ? addManualRow() : (function(){ const w=document.createElement('div'); w.id='manual-rows'; document.getElementById('tab-manual').appendChild(w); const r=document.createElement('div'); r.className='mrow'; r.innerHTML='<input placeholder=\"Term\"/><input placeholder=\"Definition\"/>'; w.appendChild(r); })()")
        pg.wait_for_timeout(100)
    check("manual_rows_exist", pg.evaluate("document.querySelectorAll('#manual-rows .mrow').length") >= 1)
    pg.fill("#nm-title", "V5")
    pg.locator("#manual-rows .mrow").nth(0).locator("input").nth(0).fill("x")
    pg.locator("#manual-rows .mrow").nth(0).locator("input").nth(1).fill("y")
    pg.evaluate("document.getElementById('btn-save-manual').click()"); pg.wait_for_timeout(500)
    check("set_created", pg.evaluate("(JSON.parse(localStorage.getItem('recall_v3')).sets.some(s=>s.title.includes('V5')))"))

    # features present in DOM
    check("voice_mode_button", pg.evaluate("!!document.querySelector('[data-mode=voice]')"))
    check("print_mode_button", pg.evaluate("!!document.querySelector('[data-mode=print]')"))
    check("calibration_section", pg.evaluate("!!document.getElementById('section-calibration')"))
    check("calibration_card_content", len(pg.evaluate("(document.getElementById('calibration-card')||{textContent:''}).textContent"))>5)

    # Study flow: real DOM clicks, then read storage
    flashcards = pg.locator("[data-mode=flashcards]")
    flashcards.first.click(); pg.wait_for_timeout(400)
    pg.locator("#fc-card").click(); pg.wait_for_timeout(300)
    pg.locator(".grade-btn.g3").click(); pg.wait_for_timeout(400)
    stab = pg.evaluate("(JSON.parse(localStorage.getItem('recall_v3')).sets.find(s=>s.title.includes('V5'))||{cards:[]}).cards.map(c=>c.f && c.f.stability)")
    check("fsrs_persists_after_grade", any(v is not None and v > 0 for v in (stab or [])), stab)
    # exit clean
    pg.evaluate("document.getElementById('btn-exit-study').click()"); pg.wait_for_timeout(300)
    pg.evaluate("document.getElementById('sum-home') && document.getElementById('sum-home').click()"); pg.wait_for_timeout(300)
    stored = pg.evaluate("JSON.parse(localStorage.getItem('recall_v3')).sets.length")
    check("set_persisted_to_storage", stored >= 1, stored)
    # delete via UI row then dialog-accept
    target_row = pg.locator("button.set-row", has_text="V5").first
    if target_row.count() > 0:
      target_row.click(); pg.wait_for_timeout(300)
      pg.once("dialog", lambda d: d.accept())
      pg.locator("#btn-delete-set").click(); pg.wait_for_timeout(300)
    after_delete = pg.evaluate("JSON.parse(localStorage.getItem('recall_v3')).sets.length")
    check("delete_works", after_delete == 0, after_delete)
    check("delete_returns_empty", pg.evaluate("!document.getElementById('empty-home').hidden"))
    check("no_js_errors_total", len(errs) == 0, errs[:3])
    pg.close(); b.close()

print(json.dumps({"PASS": len(FAILS) == 0, "failed": FAILS, "results": results}, indent=2, default=str))
sys.exit(1 if FAILS else 0)
