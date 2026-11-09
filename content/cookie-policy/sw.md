# Vidakuzi

## Jinsi Openscholar.ai inavyotumia vidakuzi

Unapovinjari openscholar.ai, faili ndogo za data zinazoitwa vidakuzi zinaweza kuhifadhiwa kwenye kifaa chako. Faili hizi husaidia tovuti kufanya kazi ipasavyo na kuwapa wamiliki wa tovuti maarifa kuhusu jinsi tovuti zao zinavyotumika. Hapa chini, tunaeleza vidakuzi ambavyo openscholar.ai inatumia na madhumuni yake.

## Vidakuzi muhimu kabisa

| **Jina** | **Madhumuni** | **Muda wa kuisha** |
| --- | --- | --- |
| `__session`, `__client_uat`, `__client` | Hukuweka umeingia | Hadi mwaka 1 |
| `NEXT_LOCALE` | Hukumbuka lugha yako | Mwaka 1 |
| `__cf_bm`, `_cfuvid` | Cloudflare huvitumia kulinda tovuti dhidi ya trafiki ya kiotomatiki | Dakika 30, au hadi ufunge kivinjari chako |

Chaguo lako la vidakuzi hubaki kwenye kidakuzi kiitwacho openscholar_consent. Mipangilio ya onyesho, kama paneli zilizo wazi, hubaki kwenye hifadhi ya ndani ya kivinjari chako.

## Vidakuzi vya utendaji na uchambuzi (hiari)

| **Jina** | **Madhumuni** | **Muda wa kuisha** |
| --- | --- | --- |
| `ph_phc_[token]_posthog`, `ph_phc_[token]_posthog_cpm` | Tunatumia PostHog kujifunza jinsi watu wanavyotumia Openscholar na kurekebisha matatizo. Vidakuzi hivi vina kitambulisho cha nasibu cha kifaa, maelezo ya kipindi chako na ukurasa uliotua kwanza. Ukiingia, vina kitambulisho cha akaunti yako, na PostHog huunganisha shughuli zako na jina lako na barua pepe yako. Hatuuzi taarifa zako kamwe. | siku 365 |
| `_ga`, `_ga_[id]` | Tunatumia Google Analytics kuona watu wangapi hututembelea na jinsi wanavyotufikia. Vidakuzi hivi vina kitambulisho cha nasibu na maelezo ya kipindi chako. | siku 400 |

### Kidakuzi cha PostHog kina data gani?

Kidakuzi cha PostHog kinahifadhi maelezo yafuatayo katika muundo uliopangwa:

- **$device_id**: Msimbo wa kipekee wa kubahatisha (UUID) uliopewa kifaa chako
- **distinct_id**: Kitambulisho kisichojulikana kwa madhumuni ya ufuatiliaji. Mwanzoni kinafanana na device_id yako, lakini kinaweza kuunganishwa na akaunti yako ukiingia
- **$sesid**: Maelezo ya kipindi chako cha sasa cha kuvinjari, ikiwa ni pamoja na kilianza lini, kitambulisho cha kipekee cha kipindi, na muda wa shughuli za hivi karibuni
- **$epp**: Alama za kiufundi zinazotumiwa na PostHog kwa vipengele vyake vya ndani
- **$initial_person_info**: Rekodi zinazoonyesha jinsi ulivyofika kwenye tovuti yetu (kama kutoka injini ya utafutaji au ziara ya moja kwa moja) na ukurasa wa kwanza uliotua

Kidakuzi hiki hakina jina lako, barua pepe yako wala maelezo mengine ya faragha.

### Data ya ziada inayokusanywa na PostHog

Mbali na kidakuzi chenyewe, PostHog inakusanya taarifa za ziada kiotomatiki:

**Maelezo ya kiufundi kuhusu kifaa na kivinjari chako:**
- Kivinjari unachotumia na nambari ya toleo lake
- Mfumo wa uendeshaji wa kifaa chako
- Kama uko kwenye kompyuta ya mezani, simu ya mkononi, au kompyuta kibao
- Ubora wa skrini yako
- Mfuatano wa utambulisho wa kivinjari kiufundi (user agent)

**Taarifa za kijiografia za makadirio:**
- Anwani yako ya IP (inayotumika kukadiria mahali pekee, haihifadhiwi kwenye vidakuzi)
- Mahali pa jumla kama nchi, jiji, au mkoa (vinakokotolewa kutoka anwani ya IP)
- Mpangilio wa eneo la saa lako la karibu

**Jinsi unavyovinjari tovuti yetu:**
- Kurasa unazotazama wakati wa ziara yako
- Tovuti uliyotoka (referrer)
- Vipengele unavyobofya, kama vitufe au viungo
- Muda unaotumia kusoma kila ukurasa
- Umbali unaosogeza chini ya ukurasa

**Taarifa tunazozitenga kwa makusudi:**
- Maandishi unayoandika kwenye fomu, isipokuwa unachotafuta
- Vitambulisho vya kuingia au nenosiri
- Maelezo ya malipo au kadi ya mkopo
- Taarifa nyingine yoyote binafsi au nyeti
- Vidakuzi vya matangazo vya watu wengine havitumiki
- Data yako haiuzwi kamwe kwa watangazaji au makampuni ya masoko

### Google Analytics

Ukikubali, Google Analytics hupokea kurasa unazotembelea, jinsi ulivyotufikia, aina ya kifaa chako na eneo lako la takriban. Haipokei unachotafuta, na vipengele vyake vya matangazo vimezimwa. Ukibadili uamuzi, tunaisimamisha na kuondoa vidakuzi vyake.

### Usipokubali

Kabla hujachagua, au ukikataa vidakuzi vya uchambuzi, tunahesabu tu ziara, bila vidakuzi na bila kuhifadhi chochote kwenye kifaa chako isipokuwa chaguo lako: ukurasa, tovuti uliyotoka, aina ya kivinjari chako, na vitendo kama kufanya utafutaji. Haturekodi mibofyo yako, unachoandika, eneo lako wala akaunti yako. Anwani yako ya IP na aina ya kivinjari hugeuka kuwa msimbo unaobadilika kila siku, na hatuhifadhi anwani yako ya IP.

## Kusimamia mapendeleo yako ya vidakuzi

Unaweza kusasisha mapendeleo yako ya vidakuzi wakati wowote kwa kubofya kiungo cha "Mapendeleo ya vidakuzi" kinachopatikana chini ya kila ukurasa wa openscholar.ai.

Zaidi ya hayo, vivinjari vyote vikuu vya mtandao vina mipangilio ya kudhibiti vidakuzi. Kwa taarifa kamili kuhusu vidakuzi na jinsi ya kuona vilivyo kwenye kifaa chako, tembelea [www.aboutcookies.org](http://www.aboutcookies.org/) au [www.allaboutcookies.org](http://www.allaboutcookies.org/).

### Miongozo ya usimamizi wa vidakuzi kwa kila kivinjari:

- [Google Chrome](https://support.google.com/accounts/answer/61416?co=GENIE.Platform%3DDesktop&hl=en)
- [Microsoft Edge](https://privacy.microsoft.com/en-us/windows-10-microsoft-edge-and-privacy)
- [Mozilla Firefox](https://support.mozilla.org/en-US/kb/enable-and-disable-cookies-website-preferences)
- [Microsoft Internet Explorer](https://support.microsoft.com/en-gb/help/17442/windows-internet-explorer-delete-manage-cookies)
- [Opera](https://www.opera.com/help/tutorials/security/privacy/)
- [Apple Safari](https://support.apple.com/en-gb/safari)

Kwa vivinjari vingine, angalia nyaraka za usaidizi zinazotolewa na msanidi wa kivinjari chako.

### Kuondoa kidakuzi cha Openscholar.ai kwenye kifaa chako

Unaweza kuondoa kidakuzi chetu cha uchambuzi wakati wowote unapotaka kwa kutumia mipangilio ya kivinjari chako:

**Google Chrome:**
1. Chagua menyu ya nukta tatu (⋮) upande wa juu kulia
2. Nenda kwenye "Settings" → "Privacy and security" → "Cookies and other site data"
3. Chagua "See all cookies and site data"
4. Andika "openscholar.ai" kwenye kisanduku cha kutafuta
5. Bofya aikoni ya kufuta karibu na kidakuzi cha PostHog

**Mozilla Firefox:**
1. Fungua menyu (≡) kisha chagua Settings
2. Nenda kwenye "Privacy & Security" → "Cookies and Site Data"
3. Chagua "Manage Data"
4. Andika "openscholar.ai" ili kupata kidakuzi
5. Kiangazie kisha chagua "Remove Selected"

**Apple Safari:**
1. Fungua Safari → Preferences → Privacy
2. Chagua "Manage Website Data"
3. Andika "openscholar.ai" kwenye sehemu ya kutafuta
4. Chagua ingizo kisha chagua "Remove"

**Microsoft Edge:**
1. Bofya menyu ya nukta tatu (⋯) upande wa juu kulia
2. Nenda kwenye Settings → Cookies and site permissions → Cookies and site data
3. Chagua "See all cookies and site data"
4. Tafuta "openscholar.ai"
5. Bofya aikoni ya kufuta

### Kuzuia vidakuzi vya uchambuzi visiwekwe

Ikiwa ungependa kuzuia kidakuzi chetu cha uchambuzi kisiundwe:

1. **Zima vidakuzi vyote**: Weka kivinjari chako kikatae vidakuzi vyote (kumbuka: hii inaweza kuathiri jinsi tovuti nyingine zinavyofanya kazi)
2. **Zuia vidakuzi vya watu wengine pekee**: Hii inazuia wafuatiliaji wa nje huku ikiruhusu kidakuzi chetu cha uchambuzi cha mtumiaji wa kwanza - hii haitazuia kidakuzi cha openscholar.ai
3. **Sakinisha viendelezi vya faragha vya kivinjari**: Zana zinazolenga faragha kama Privacy Badger au uBlock Origin zinaweza kuzuia vidakuzi vya uchambuzi
4. **Washa Do Not Track**: Ingawa openscholar.ai kwa sasa haitii ishara za DNT, unaweza kuwasha chaguo hili kwenye mipangilio ya kivinjari chako
5. **Tumia mipangilio yetu ya vidakuzi**: Bofya "Mapendeleo ya vidakuzi" chini ya ukurasa wowote wa openscholar.ai ili kurekebisha mapendeleo yako

### Wasiliana nasi

Kwa maswali kuhusu taratibu zetu za vidakuzi, tafadhali wasiliana nasi:

**Barua pepe**: habari@openscholar.ai

**Ilisasishwa mara ya mwisho**: 4 Novemba 2026
