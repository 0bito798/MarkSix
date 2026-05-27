import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "新澳门六合彩特别号码预测",
  description: "新澳门六合彩特别号码预测与复盘看板",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hans">
      <body>
        <header className="topbar">
          <h1>新澳门六合彩预测看板</h1>
          <nav>
            <a href="/">特别号预测</a>
            <a href="/predictions">预测历史</a>
            <a href="/history">历史数据</a>
            <a href="/review">复盘</a>
          </nav>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
