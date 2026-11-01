// 测试用：平台要求每个故事都接 AI；测试里的小故事没写 ai 时补一个最小的叙述接入点
export const AI_BLOCK = `
ai:
  entry_points:
    narrator:
      kind: narrate
      trigger: game_end
      prompt: 用一两句话为结局写一句收尾。
      fallback: { zh: 故事结束了。, en: The story ends. }
      card:
        task: 简短为结局写一句收尾
        authority: 0
        output: { format: text, max_chars: 120 }
`;
export const withAi = (y: string) => (/^ai:/m.test(y) || !/^spec:/m.test(y) ? y : y.replace(/\s*$/, "\n") + AI_BLOCK);
