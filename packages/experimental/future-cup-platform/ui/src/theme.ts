import { theme } from 'antd'
import type { ThemeConfig } from 'antd'

export const managementTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: '#1e1f22',
    colorInfo: '#3b6a9c',
    colorLink: '#3b6a9c',
    colorSuccess: '#2e8b63',
    colorWarning: '#d97706',
    colorError: '#d93829',
    colorBgLayout: '#f2f1ec',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorText: '#1c1d1f',
    colorTextSecondary: '#6e7178',
    colorBorder: '#e6e4dd',
    borderRadius: 12,
    borderRadiusLG: 18,
    fontFamily: 'Archivo, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize: 13,
    controlHeight: 36,
  },
  components: {
    Layout: {
      bodyBg: 'transparent',
      headerBg: 'transparent',
      siderBg: 'transparent',
    },
    Menu: {
      itemBg: 'transparent',
      subMenuItemBg: 'transparent',
      itemColor: '#6e7178',
      itemHoverColor: '#1c1d1f',
      itemHoverBg: '#ffffff',
      itemSelectedColor: '#1c1d1f',
      itemSelectedBg: '#e8f0fa',
      itemBorderRadius: 11,
      itemMarginInline: 0,
      itemMarginBlock: 6,
      itemHeight: 44,
    },
    Table: {
      headerBg: '#f7f6f2',
      headerColor: '#6e7178',
      rowHoverBg: '#f7f6f2',
      borderColor: '#e5e3dc',
      cellPaddingBlockSM: 9,
      cellPaddingInlineSM: 12,
    },
    Card: {
      bodyPadding: 20,
    },
    Modal: {
      contentBg: '#ffffff',
      headerBg: '#ffffff',
      colorBgMask: 'rgba(28, 29, 31, 0.42)',
    },
    Drawer: {
      colorBgElevated: '#ffffff',
    },
    Button: {
      defaultBg: '#ffffff',
      defaultBorderColor: '#e4e2db',
      defaultColor: '#1c1d1f',
      primaryShadow: '0 6px 16px rgba(30, 31, 34, 0.18), 0 1px 2px rgba(30, 31, 34, 0.12)',
      fontWeight: 500,
    },
    Input: {
      activeBg: '#f7f6f2',
      hoverBg: '#f7f6f2',
    },
    Select: {
      selectorBg: '#f7f6f2',
    },
  },
}
