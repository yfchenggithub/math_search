export type ApiEnv = "develop" | "trial" | "release";

export function readApiEnvVersion(): ApiEnv {
  return wx.getAccountInfoSync().miniProgram.envVersion;
}
