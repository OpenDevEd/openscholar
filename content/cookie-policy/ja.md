# Cookie（クッキー）

## OpenScholar.aiでのCookieの使用方法

openscholar.aiを閲覧すると、小さなデータファイルであるCookieがデバイスに保存される場合があります。これらのファイルは、Webサイトが適切に機能するために役立つほか、Webサイト所有者に対してそのサイトがどのように使用されているかについての洞察を提供します。以下では、openscholar.aiで使用するCookieとその目的について説明します。

## 必ず必要なCookie

OpenScholar.aiは、Webサイトの機能に必要なCookieを現在設定していません。

## パフォーマンスおよび分析Cookie（任意）

| **名前** | **目的** | **有効期限** |
| --- | --- | --- |
| ph_phc_[token]_posthog | 当社はPostHog分析ソフトウェアを使用して、人々がWebSiteとどのように対話するかを学習しています。これにより、より良いレポートの作成とユーザー体験の向上が可能になります。このCookieには、匿名デバイス識別子、閲覧セッションの詳細、および最初にアクセスしたランディングページが含まれます。すべてのデータは匿名で収集されます。当社はあなたを個人として特定することは一切ありません。OpenScholar.aiはサードパーティのトラッキング技術を使用せず、あなたの情報を広告会社ものに売ることはありません。 | 365日 |

### PostHog Cookieにはどのようなデータが含まれていますか？

PostHog Cookieは次の詳細を構造化された形式で保存します：

- **$device_id**：デバイスに割り当てられた一意のランダムコード（UUID）
- **distinct_id**：トラッキング用の匿名識別子。最初はdevice_idと同じですが、ログインするとアカウントにリンクされる場合があります
- **$sesid**：現在の閲覧セッションの詳細。開始時刻、一意のセッション識別子、および最近のアクティビティのタイムスタンプを含む
- **$epp**：PostHogが内部機能に使用する技術フラグ
- **$initial_person_info**：どのように 当社のサイトにアクセスしたか（検索エンジンや直接訪問など）、および最初にアクセスしたページを記録

このCookieには、氏名、メールアドレス、その他の個人情報など、あなたを個人として特定できる情報は含まれていません。

### PostHogによって収集される追加データ

Cookie自体に加えて、PostHogは自動的に追加情報を収集します：

**デバイスとブラウザの技術的詳細：**
- 使用しているブラウザとそのバージョン番号
- デバイスのオペレーティングシステム
- デスクトップ、モバイル電話、タブレートのいずれを使用しているか
- 画面の表示解像度
- 技術的なブラウザ識別子（ユーザーエージェント）

**大まかな地理的位置情報：**
- IPアドレス（位置の推定のみに使用され、Cookieに保存されません）
- 国、都市、地域などの一般的な場所（IPアドレスから計算）
- ローカルタイムゾーン設定

**WebSiteでのナビゲーション：**
- 訪問中に閲覧したページ
- アクセス元WebSite（リファラー）
- クリックした要素（ボタンやリンクなど）
- 各ページの閲覧時間
- ページをスクロールした深さ

**意図的に除外されている情報：**
- フォームに入力したテキスト
- ログイン資格情報またはパスワード
- 支払いまたはクレジットカードの詳細
- その他すべての個人情報や機微な個人データ
- サードパーティの広告Cookieは使用されません
- あなたのデータが広告主やマーケティング会社に売られることは一切ありません

## Cookie設定の管理

openscholar.aiの各ページの下部にある「Cookie設定」リンクをクリックすることで、Cookie設定を更新できます。

また、すべての主要なWebブラウザには、Cookieを制御するための設定があります。Cookieの詳細とデバイスに保存されているCookieを確認する方法については、[www.aboutcookies.org](http://www.aboutcookies.org/)または[www.allaboutcookies.org](http://www.allaboutcookies.org/)をご覧ください。

### ブラウザ別のCookie管理ガイド：

- [Google Chrome](https://support.google.com/accounts/answer/61416?co=GENIE.Platform%3DDesktop&hl=en)
- [Microsoft Edge](https://privacy.microsoft.com/en-us/windows-10-microsoft-edge-and-privacy)
- [Mozilla Firefox](https://support.mozilla.org/en-US/kb/enable-and-disable-cookies-website-preferences)
- [Microsoft Internet Explorer](https://support.microsoft.com/en-gb/help/17442/windows-internet-explorer-delete-manage-cookies)
- [Opera](https://www.opera.com/help/tutorials/security/privacy/)
- [Apple Safari](https://support.apple.com/en-gb/safari)

その他のブラウザについては、ブラウザの開発者が提供するサポートドキュメントをご覧ください。

### デバイスからOpenScholar.aiのCookieを削除する

ブラウザの設定で、分析Cookieをいつでも削除できます：

**Google Chrome：**
1. 右上の3点リーダー（⋮）を選択
2. 設定 → プライバシーとセキュリティ → Cookieとサイトデータに移動
3. 「すべてのCookieとサイトデータを選択」を選択
4. 検索ボックスに「openscholar.ai」と入力
5. PostHog Cookieの横にある削除アイコンをクリック

**Mozilla Firefox：**
1. メニュー（≡）を開き、設定を選択
2. プライバシーとセキュリティ → Cookieとサイトデータに移動
3. 「データを管理」を選択
4. 「openscholar.ai」と入力してCookieを見つける
5. 強調表示して「選択項目を削除」を選択

**Apple Safari：**
1. Safariを開く → 環境設定 → プライバシー
2. 「WebSiteデータを管理」を選択
3. 検索フィールドに「openscholar.ai」と入力
4. エントリを選択して「削除」をクリック

**Microsoft Edge：**
1. 右上の3点リーダー（⋯）をクリック
2. 設定 → Cookieとサイト権限 → Cookieとサイトデータに移動
3. 「すべてのCookieとサイトデータを選択」を選択
4. 「openscholar.ai」を検索
5. 削除アイコンをクリック

### 分析Cookieが設定されることを防ぐ

分析Cookieが作成されることを停止したい場合は：

1. **すべてのCookieを無効にする**：ブラウザを設定してすべてのCookieを拒否するように構成する（注意：これは他のWebSiteの動作に影響を与える可能性があります）
2. **サードパーティCookieのみをブロックする**：これにより、外部トラッカーは停止しますが、当社のファーストパーティ分析Cookieは許可されます—これはopenscholar.aiのCookieをブロックしません
3. **プライバシーブラウザ拡張機能をインストールする**：Privacy BadgerやuBlock Originなどのプライバシーツールが分析Cookieを阻止できます
4. **トラッキング防止を有効にする**：openscholar.aiは現在DNT信号を尊重していませんが、ブラウザ設定でこのオプションをアクティブにできます
5. **当社のCookie設定を使用する**：openscholar.ai任意のページの下部にある「Cookie設定」をクリックして、設定を調整してください

### お問い合わせ

Cookieポリシーに関するご質問は、以下までお問い合わせください：

**メール**：contact@opendeved.net

**最終更新日**：2026年2月13日
