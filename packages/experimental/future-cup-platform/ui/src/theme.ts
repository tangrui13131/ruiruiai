import { theme } from 'antd'
import type { ThemeConfig } from 'antd'

export const managementTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: '#0f766e',
    colorInfo: '#0f766e',
    colorSuccess: '#15803d',
    colorWarning: '#b45309',
    colorError: '#b91c1c',
    colorBgLayout: '#f3f6f4',
    colorBgContainer: '#ffffff',
    colorText: '#17211d',
    colorTextSecondary: '#5c6b64',
    colorBorder: '#d8e0dc',
    borderRadius: 8,
    borderRadiusLG: 8,
    fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize: 13,
    controlHeight: 34,
  },
  components: {
    Layout: {
      bodyBg: '#f3f6f4',
      headerBg: '#ffffff',
      siderBg: '#17211d',
    },
    Menu: {
      darkItemBg: '#17211d',
      darkSubMenuItemBg: '#17211d',
      darkItemSelectedBg: '#0f766e',
      darkItemHoverBg: '#22322b',
      itemBorderRadius: 8,
    },
    Table: {
      headerBg: '#f0f4f2',
      headerColor: '#42524a',
      rowHoverBg: '#f7faf8',
      cellPaddingBlockSM: 8,
      cellPaddingInlineSM: 10,
    },
    Card: {
      bodyPadding: 16,
    },
  },
}
