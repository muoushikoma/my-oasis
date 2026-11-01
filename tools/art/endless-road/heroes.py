# 生成 4 个职业主角的像素字符网格，写进 pix.js 的 SPRITES（hero_fighter / hero_rogue / hero_wizard / hero_cleric）
W = 22
def pad(rows): return [r.ljust(W, ".")[:W] for r in rows]

HEADS = {
 "fighter": ["......%%%%..", ".....%WwwW%.", "....%WwwWWW%", "....%WWWWWW%", "....%%%%%%%.", "....h%ssses.", ".....%sssss.", "......SsSS.."],
 "rogue":   [".....MMMM...", "....MmmmmM..", "...MmmmmmmM.", "...Mmm#sss..", "...Mmm#sses.", "...MmmMssss.", "....MVVVVV..", ".....VVVV..."],
 "wizard":  ["..EB........", "...EBB......", "....EBBB....", "....EBBBBk..", "..EEEEEEEEE.", "....hhsssss.", "....hhssses.", ".....hsssss."],
 "cleric":  ["......hhhh..", ".....hHHHHh.", "....hHHhhhhh", "....hkkKkkk.", "....hhhssss.", "....hhhsses.", ".....hhssss.", "......SsSS.."],
}
TORSO = {
 "fighter": {
  "idle": [".....cWWWWW.", "....cWWwwwWW", "....cWwwwwW%ss", "...ccW%www%%.sk", "...ccW%%WW%%..kW", "...cc%bbkbb%...W", "...cc.WW%WW....w", "...cc.pppPP....w", "...c..pppPP....W"],
  "atk":  [".....cWWWWW.", "....cWWwwwWWss", "....cWwwwwWWsskWWWWWWWw", "...ccW%www%%..k%%%%%%%.", "...ccW%%WW%%", "...cc%bbkbb%", "...cc.WW%WW.", "...cc.pppPP.", "...c..pppPP."],
 },
 "rogue": {
  "idle": ["....MVVVVV..", "...MAaaaaA..", "...MAaaaaAs.", "...MaAaaaAs.", "...MaAbbkbsW", "...MAaaaAA.%", "....AaaaAA..", "....ppppPP..", "....ppp.PP.."],
  "atk":  ["....MVVVVV..", "...MAaaaaA..", "...MAaaaaAss", "...MaAaaaA.ssW%%", "...MaAbbkb......", "...MAaaaAA..", "....AaaaAA..", "....ppppPP..", "....ppp.PP.."],
 },
 "wizard": {
  "idle": [".....hBBBB..x", "....BBBBBBB.I", "....BBkBBBBsx", "...BBBkBBBBsx", "...BBBkBBBB.x", "...BEBkBBBB.x", "...BEBkBBBB.x", "...BEBkBBBBEx", "...BEBkBBBBEx"],
  "atk":  [".....hBBBB.....", "....BBBBBBB....", "....BBkBBBBssxxxxI", "...BBBkBBBB.....", "...BBBkBBBB.", "...BEBkBBBB.", "...BEBkBBBB.", "...BEBkBBBBE", "...BEBkBBBBE"],
 },
 "cleric": {
  "idle": [".....WW%WW..", "....W1111W..", "....W11k11s.", "....W1kKk1s.", "....W11k11sW", "....bbbkbb.W", "....W11112.Y", "....111122.Y", "....111122.Y"],
  "atk":  [".....WW%WW..", "....W1111Wss", "....W11k11sYYWW", "....W1kKk1..YW%W", "....W11k11...W%", "....bbbkbb..", "....W11112..", "....111122..", "....111122.."],
 },
}
# 裤装职业的腿（9 行）
PANTS = {
 "idle": ["......ppPP..", "......pp.PP.", "......pp.PP.", "......pp.PP.", "......pp.PP.", "......pp.PP.", "......tt.TT.", ".....ttt.TTT"],
 "w1":   ["......ppPP..", ".....pp..PP.", ".....pp...PP", "....pp....PP", "....pp.....PP", "...pp......PP", "...tt.......TT", "..ttt.......TTT"],
 "w2":   ["......ppPP..", "......ppPP..", "......pPP...", "......pPPp..", "......PP.p..", "......PP.pp.", "......TT..tt", ".....TTT..tt"],
 "w3":   ["......ppPP..", ".....PP..pp.", ".....PP...pp", "....PP....pp", "....PP.....pp", "...PP......pp", "...TT.......tt", "..TTT.......ttt"],
 "w4":   ["......ppPP..", "......PPpp..", "......Ppp...", "......Pppp..", "......pp.P..", "......pp.PP.", "......tt..TT", ".....ttt..TT"],
 "lunge":["......ppPP..", ".....pp..PP.", "....pp....PP", "...pp......PP", "..pp.......PP", "..pp........PP", ".tt.........TT", "ttt.........TTT"],
}
def robe(c1, c2, trim):
  base = lambda hem, feet: [f"...{c1*7}{c2}..", f"...{c1*7}{c2}..", f"..{c1*8}{c2}{c2}.", f"..{c1*8}{c2}{c2}.", f".{c1*9}{c2*3}", hem, feet[0], feet[1]]
  return {
   "idle": base(f".{trim*12}", ["....tt..TT..", "...ttt.TTT.."]),
   "w1":   base(f"{trim*12}.", ["..tt....TT..", ".ttt.....TTT"]),
   "w2":   base(f".{trim*12}", ["....ttTT....", "...tttTTT..."]),
   "w3":   base(f"..{trim*12}", ["..TT....tt..", ".TTT.....ttt"]),
   "w4":   base(f".{trim*12}", ["....TTtt....", "...TTTttt..."]),
   "lunge":base(f"{trim*12}.", ["..tt....TT..", ".ttt.....TTT"]),
  }
LEGS = {"fighter": PANTS, "rogue": PANTS, "wizard": robe("B", "E", "k"), "cleric": robe("1", "2", "k")}

out = []
for cls in ["fighter", "rogue", "wizard", "cleric"]:
  frames = []
  for leg, tor in [("idle", "idle"), ("w1", "idle"), ("w2", "idle"), ("w3", "idle"), ("w4", "idle"), ("lunge", "atk")]:
    rows = pad(HEADS[cls] + TORSO[cls][tor] + LEGS[cls][leg])
    frames.append("    [" + ", ".join(f'"{r}"' for r in rows) + "]")
  out.append(f"  hero_{cls}: {{ frames: [\n" + ",\n".join(frames) + ",\n  ] },")
block = "\n".join(out) + "\n"
p = "pix.js"; s = open(p).read()
import re
s = re.sub(r"  hero_(fighter|rogue|wizard|cleric): \{ frames: \[\n.*?\n  \] \},\n", "", s, flags=re.S)
anchor = "  // 像素字体"
assert anchor in s
s = s.replace(anchor, "  // ===== 职业主角（朝右）：0 站立，1-4 走路，5 攻击 =====\n" + block + anchor, 1)
open(p, "w").write(s)
print("ok")
