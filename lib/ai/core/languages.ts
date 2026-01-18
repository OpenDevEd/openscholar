export interface LanguageOption {
  code: string
  name: string
  flagUrl: string
}

export const languageOptions: LanguageOption[] = [
  { code: "en", name: "English", flagUrl: "https://flagcdn.com/w20/gb.png" },
  { code: "es", name: "Spanish", flagUrl: "https://flagcdn.com/w20/es.png" },
  { code: "fr", name: "French", flagUrl: "https://flagcdn.com/w20/fr.png" },
  { code: "de", name: "German", flagUrl: "https://flagcdn.com/w20/de.png" },
  { code: "it", name: "Italian", flagUrl: "https://flagcdn.com/w20/it.png" },
  { code: "pt", name: "Portuguese", flagUrl: "https://flagcdn.com/w20/pt.png" },
  { code: "zh", name: "Chinese", flagUrl: "https://flagcdn.com/w20/cn.png" },
  { code: "ja", name: "Japanese", flagUrl: "https://flagcdn.com/w20/jp.png" },
  { code: "ko", name: "Korean", flagUrl: "https://flagcdn.com/w20/kr.png" },
  { code: "ru", name: "Russian", flagUrl: "https://flagcdn.com/w20/ru.png" },
  { code: "ar", name: "Arabic", flagUrl: "https://flagcdn.com/w20/sa.png" },
  { code: "nl", name: "Dutch", flagUrl: "https://flagcdn.com/w20/nl.png" },
  { code: "sv", name: "Swedish", flagUrl: "https://flagcdn.com/w20/se.png" },
  { code: "no", name: "Norwegian", flagUrl: "https://flagcdn.com/w20/no.png" },
  { code: "da", name: "Danish", flagUrl: "https://flagcdn.com/w20/dk.png" },
  { code: "fi", name: "Finnish", flagUrl: "https://flagcdn.com/w20/fi.png" },
  { code: "tr", name: "Turkish", flagUrl: "https://flagcdn.com/w20/tr.png" },
  { code: "pl", name: "Polish", flagUrl: "https://flagcdn.com/w20/pl.png" },
  { code: "cs", name: "Czech", flagUrl: "https://flagcdn.com/w20/cz.png" },
  { code: "hu", name: "Hungarian", flagUrl: "https://flagcdn.com/w20/hu.png" },
  { code: "he", name: "Hebrew", flagUrl: "https://flagcdn.com/w20/il.png" },
  { code: "hi", name: "Hindi", flagUrl: "https://flagcdn.com/w20/in.png" },
  { code: "th", name: "Thai", flagUrl: "https://flagcdn.com/w20/th.png" },
  { code: "vi", name: "Vietnamese", flagUrl: "https://flagcdn.com/w20/vn.png" },
  { code: "id", name: "Indonesian", flagUrl: "https://flagcdn.com/w20/id.png" },
  { code: "ms", name: "Malay", flagUrl: "https://flagcdn.com/w20/my.png" },
  { code: "uk", name: "Ukrainian", flagUrl: "https://flagcdn.com/w20/ua.png" },
  { code: "ro", name: "Romanian", flagUrl: "https://flagcdn.com/w20/ro.png" },
  { code: "bg", name: "Bulgarian", flagUrl: "https://flagcdn.com/w20/bg.png" },
  { code: "hr", name: "Croatian", flagUrl: "https://flagcdn.com/w20/hr.png" },
]

export function getLanguageName(code: string): string | undefined {
  return languageOptions.find(option => option.code === code)?.name
}