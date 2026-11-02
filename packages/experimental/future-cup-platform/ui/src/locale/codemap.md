# packages/experimental/future-cup-platform/ui/src/locale/

## Responsibility
Internationalization (i18n) dictionaries and localized string mappings.

## Design
Type-safe bilingual dictionary (zh-CN / en-US) with interpolation helpers.

## Flow
t("key") lookup -> Returns localized text with fallback support.

## Integration
Injected into UI components and Ant Design ConfigProvider locale.
