# 生成界面素材的像素网格（9 宫格边框、按钮、图标），写进 pix.js：ui_* 是原样输出（raw），icons 自动描边
import re
UIPAL = {"4": "#120c08", "5": "#8a5a32", "6": "#6a4224", "7": "#4a2c18", "8": "#221b15", "9": "#2a221a",
         "&": "#ecdcb2", "*": "#dfc898", "=": "#c4a46c", "~": "#4a2e14", "^": "#fff6dc", "<": "#ad7e4a", ">": "#ffe9a8"}

def frame(n, f):
    rows = []
    for y in range(n):
        r = ""
        for x in range(n):
            r += f(x, y, min(x, y, n - 1 - x, n - 1 - y), x <= y if x + y < n else False)
        rows.append(r)
    return rows

def wood(x, y, e, _):
    n = 24
    if (x in (0, n - 1)) and (y in (0, n - 1)): return "."
    tl = x + y < n - 1  # 左上半边亮，右下半边暗
    if e == 0: return "4"
    if e == 1: return "5" if tl else "7"
    if e == 2: return "6"
    if e == 3: return "k" if tl else "K"
    if e == 4: return "4"
    if (x, y) in [(2, 2), (n - 3, 2), (2, n - 3), (n - 3, n - 3)]: return "k"
    return "8" if (x + y) % 7 else "9"

def paper(x, y, e, _):
    n = 24
    if (x in (0, n - 1)) and (y in (0, n - 1)): return "."
    tl = x + y < n - 1
    if e == 0: return "~"
    if e == 1: return "=" if not tl else "*"
    if e == 2: return "*" if (x * 3 + y) % 5 else "="
    return "&" if (x * 7 + y * 3) % 11 else "*"

def button(fill, hi, lo, edge="4"):
    def f(x, y, e, _):
        n = 12
        if (x in (0, n - 1)) and (y in (0, n - 1)): return "."
        if e == 0: return edge
        if e == 1: return hi if (y == 1 or x == 1) and not (y == n - 2 or x == n - 2) else (lo if (y == n - 2 or x == n - 2) else fill)
        return fill
    return f

SPR = {
  "ui_frame_wood": frame(24, wood),
  "ui_frame_paper": frame(24, paper),
  "ui_btn_wood": frame(12, button("6", "<", "7")),
  "ui_btn_gold": frame(12, button("k", ">", "K")),
  "ui_btn_paper": frame(12, button("&", "^", "=", "~")),
  "ui_btn_down": frame(12, button("7", "7", "6")),
}

ICONS = [
 ("heart", [".RR..RR..", "RirRRrrR.", "RiirrrrrR", "RirrrrrrR", ".RrrrrrR.", "..RrrrR..", "...RrR...", "....R...."]),
 ("ration", ["...YYYY...", ".YYffffYY.", "YffxfxfxfY", "YfxfxfxffY", "YxxxxxxxxY", ".YYYYYYYY."]),
 ("potion", ["...YY...", "...WW...", "..W..W..", ".WrrrrW.", "WriirrrW", "WrirrrrW", "WrrrrrRW", ".WWWWWW."]),
 ("coin", ["..KKKK..", ".KkOkkK.", "KkOkkkkK", "KkOkKkkK", "KkkkKkkK", "KkkkkkkK", ".KkkkkK.", "..KKKK.."]),
 ("iron", ["..........", "...WWWWW..", "..WwwwwW%.", ".W%%%%%%%%", "W%%%%%%%%.", "%%%%%%%%.."]),
 ("essence", ["...I....", "..IiI...", ".IiIEI..", "IiIIIEI.", ".IIIEE..", "..IEE...", "...E...."]),
 ("shield", ["WWWWWWW", "WBBkBBW", "WBBkBBW", "WkkkkkW", "WBBkBBW", ".WBkBW.", "..WkW..", "...W..."]),
 ("flag", ["xRRRR.", "xRRRRR", "xRRRR.", "x.....", "x.....", "x.....", "x....."]),
 ("sword", ["......Ww", ".....Ww.", "....Ww..", ".k.Ww...", "..kw....", "..xk....", ".x..k...", "x......."]),
 ("dice", ["1111111", "1#111#1", "1111111", "111#111", "1111111", "1#111#1", "1111111"]),
 ("bag", ["..YY..", ".Y..Y.", "..xx..", ".xxxx.", "xxkxxx", "xxxxxx", ".xxxx."]),
 ("clover", [".vv.vv.", "vvvvvvv", ".vvvvv.", "vvvvvvv", ".vv.vv.", "...V...", "..V...."]),
 ("scroll", ["22222..", "2111122", ".211112", ".211112", ".211112", "2111122", "22222.."]),
 ("star", ["...k...", "...k...", "kkkOkkk", ".kOOOk.", "..kkk..", ".kk.kk.", "k.....k"]),
 ("fire", ["...F...", "..FF...", "..FOF..", ".FOOF..", ".FOOOF.", "RFOOFR.", ".YxxY.."]),
 ("boot", ["..AA..", "..AA..", "..AA..", "..AAA.", ".AAAAA", "TTTTTT"]),
 ("gem", ["..mmm..", ".mimmM.", "mmmmmMM", ".mmmM..", "..mM...", "...M..."]),
 ("person", ["..sss..", "..sss..", "...s...", ".BBBBB.", "..BBB..", "..B.B..", "..B.B.."]),
 ("pack", [".AAAA.", "AaaaaA", "AakkaA", "AaaaaA", "AaaaaA", ".AAAA."]),
 ("skull", [".nnnn.", "nnnnnn", "n##n##", "nnnnnn", ".n#n#.", ".nnnn."]),
 ("check", [".......v", "......vv", "v....vv.", "vv..vv..", ".vvvv...", "..vv...."]),
 ("cross", ["R.....R", ".R...R.", "..R.R..", "...R...", "..R.R..", ".R...R.", "R.....R"]),
 ("hammer", ["WWWW..", "WWWWW.", "WWWW..", "..x...", "..x...", "..x...", "..x..."]),
 ("map", ["2222222", "2112112", "2121212", "2112112", "2211212", "2222222"]),
 ("hourglass", ["xxxxxx", ".1111.", "..11..", "..11..", ".1kk1.", "xxxxxx"]),
]

def emit():
    p = "pix.js"; s = open(p).read()
    s = re.sub(r"  // ===== 界面素材 =====\n.*?  // ===== 界面素材结束 =====\n", "", s, flags=re.S)
    body = "  // ===== 界面素材 =====\n"
    for k, rows in SPR.items():
        body += f"  {k}: {{ raw: true, frames: [[" + ", ".join(f'"{r}"' for r in rows) + "]] },\n"
    body += "  // 图标顺序：" + " ".join(n for n, _ in ICONS) + "\n"
    body += "  icons: { frames: [\n" + ",\n".join("    [" + ", ".join(f'"{r}"' for r in rows) + "]" for _, rows in ICONS) + ",\n  ] },\n"
    body += "  // ===== 界面素材结束 =====\n"
    anchor = "  // 像素字体"
    s = s.replace(anchor, body + anchor, 1)
    # 调色板补充
    pal_add = ", ".join(f'"{k}": "{v}"' for k, v in UIPAL.items())
    s = re.sub(r'  "#": "#1a1420",', f'  "#": "#1a1420", {pal_add},', s, count=1) if '"4": ' not in s else s
    open(p, "w").write(s)
    print("icons:", " ".join(n for n, _ in ICONS))
emit()
