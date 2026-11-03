/* ============================================================
 * 站点配置：部署到 GitHub Pages 后，只需要改这个文件
 * ============================================================ */
window.APP_CONFIG = {
  // 你的 GitHub 用户名 / 仓库名（注意：不是 pages 的域名）
  owner: 'YiKing0130',
  repo: 'Singing-Competition',
  branch: 'main',

  // 数据目录（相对仓库根目录）
  dir: 'data',

  // GitHub 细粒度访问令牌（Fine-grained token），权限只勾：
  //   Contents → Read and write，仓库只选这一个
  // 留空 = 本地演示模式（只存在本机浏览器里，多台手机之间不同步）
  token: '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',

  // 后台口令（只是进门提示，不是真安全；真正的防护是比赛后删 token）
  adminKey: '8888',

  // 页面轮询间隔（毫秒）
  pollScreen: 3000,   // 大屏取票数
  pollMeta: 8000      // 大屏取配置/名单
};
