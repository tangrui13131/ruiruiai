import { theme } from 'antd'
import type { ThemeConfig } from 'antd'

export const managementTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: '#304bc7',
    colorInfo: '#304bc7',
    colorSuccess: '#1e7e46',
    colorWarning: '#b45309',
    colorError: '#b91c1c',
    colorBgLayout: '#f2e8e0',
    colorBgContainer: '#f6ede5',
    colorBgElevated: '#f6ede5',
    colorText: '#28241f',
    colorTextSecondary: '#7a7066',
    colorBorder: '#dfd3c9',
    borderRadius: 12,
    borderRadiusLG: 18,
    fontFamily: 'Archivo, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize: 13,
    controlHeight: 36,
  },
  components: {
    Layout: {
      bodyBg: '#f2e8e0',
      headerBg: '#f2e8e0',
      siderBg: '#f2e8e0',
    },
    Menu: {
      itemBg: 'transparent',
      subMenuItemBg: 'transparent',
      itemColor: '#5c534a',
      itemHoverColor: '#304bc7',
      itemHoverBg: '#ebe0d6',
      itemSelectedColor: '#304bc7',
      itemSelectedBg: '#ece1d7',
      itemBorderRadius: 11,
      itemMarginInline: 0,
      itemMarginBlock: 6,
      itemHeight: 44,
    },
    Table: {
      headerBg: '#ece1d7',
      headerColor: '#5c5248',
      rowHoverBg: '#f9f2eb',
      borderColor: '#e2d6cc',
      cellPaddingBlockSM: 9,
      cellPaddingInlineSM: 12,
    },
    Card: {
      bodyPadding: 20,
    },
    Modal: {
      contentBg: '#f2e8e0',
      headerBg: '#f2e8e0',
    },
    Drawer: {
      colorBgElevated: '#f2e8e0',
    },
    Button: {
      defaultBg: '#f2e8e0',
      defaultBorderColor: '#fcf4ed',
      defaultColor: '#28241f',
      fontWeight: 500,
    },
    Input: {
      activeBg: '#efe4db',
      hoverBg: '#f4eae1',
    },
    Select: {
      selectorBg: '#efe4db',
    },
  },
}
