#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""NovaHub · 星隅 站长运维 CLI：生成 Pro 兑换卡密与动态管理广告赞助位。

常用示例：
  python admin_cli.py gen-codes 5 30 --note "月卡批次"
  python admin_cli.py set-ad --on --title "赞助支持" --desc "..." --url "https://..."
  python admin_cli.py set-ad --off
  python admin_cli.py stats
"""

import argparse
import json
import db


def main():
    db.init_db()
    parser = argparse.ArgumentParser(description="NovaHub 站长运维工具")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_gen = sub.add_parser("gen-codes", help="批量生成 Pro 会员兑换卡密")
    p_gen.add_argument("count", type=int, help="生成数量")
    p_gen.add_argument("days", type=int, help="单张卡密有效天数（如 30/90/365）")
    p_gen.add_argument("--note", default="", help="批次备注")

    p_ad = sub.add_parser("set-ad", help="动态开关广告位或更新赞助文案")
    p_ad.add_argument("--on", action="store_true", help="开启赞助广告位")
    p_ad.add_argument("--off", action="store_true", help="关闭赞助广告位")
    p_ad.add_argument("--title", default=None, help="赞助标题")
    p_ad.add_argument("--desc", default=None, help="赞助描述")
    p_ad.add_argument("--url", default=None, help="点击跳转链接（留空则跳会员中心）")
    p_ad.add_argument("--btn", default=None, help="按钮文字")
    p_ad.add_argument("--tip", default=None, help="会员中心赞助提示语")

    sub.add_parser("stats", help="查看当前注册用户、卡密及广告配置状态")

    args = parser.parse_args()
    if args.cmd == "gen-codes":
        codes = db.generate_codes(args.count, args.days, args.note)
        print(f"已生成 {len(codes)} 张 {args.days} 天 Pro 卡密：")
        for c in codes:
            print(" ", c)
    elif args.cmd == "set-ad":
        if args.on:
            db.set_site_config("ad_enabled", "1")
        if args.off:
            db.set_site_config("ad_enabled", "0")
        if args.title is not None:
            db.set_site_config("ad_title", args.title)
        if args.desc is not None:
            db.set_site_config("ad_desc", args.desc)
        if args.url is not None:
            db.set_site_config("ad_url", args.url)
        if args.btn is not None:
            db.set_site_config("ad_btn", args.btn)
        if args.tip is not None:
            db.set_site_config("sponsor_tip", args.tip)
        print("当前站点商业配置：")
        print(json.dumps(db.get_public_config(), ensure_ascii=False, indent=2))
    elif args.cmd == "stats":
        with db._conn() as c:
            u_cnt = c.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            unused = c.execute("SELECT COUNT(*) FROM redeem_codes WHERE used_by IS NULL").fetchone()[0]
            used = c.execute("SELECT COUNT(*) FROM redeem_codes WHERE used_by IS NOT NULL").fetchone()[0]
        print(f"注册用户: {u_cnt} | 未使用卡密: {unused} | 已核销卡密: {used}")
        print("当前配置:", json.dumps(db.get_public_config(), ensure_ascii=False))


if __name__ == "__main__":
    main()
