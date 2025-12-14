import * as vscode from 'vscode';
import { CheckpointViewProvider } from './webview-provider';
import { MCPServerManager } from './server-manager';

let serverManager: MCPServerManager | undefined;
let viewProvider: CheckpointViewProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log('Turn MCP 插件已激活');

  // 初始化服务器管理器
  serverManager = new MCPServerManager(context);

  // 初始化WebView提供者
  viewProvider = new CheckpointViewProvider(context.extensionUri, serverManager);

  // 注册WebView
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'turn-mcp.mainView',
      viewProvider
    )
  );

  // 注册命令
  context.subscriptions.push(
    vscode.commands.registerCommand('turn-mcp.showPanel', () => {
      vscode.commands.executeCommand('turn-mcp.mainView.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('turn-mcp.startServer', async () => {
      await serverManager?.start();
      viewProvider?.updateStatus();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('turn-mcp.stopServer', async () => {
      await serverManager?.stop();
      viewProvider?.updateStatus();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('turn-mcp.autoConfig', async () => {
      const result = await serverManager?.autoConfigureMCP();
      if (result?.success) {
        vscode.window.showInformationMessage(result.message, '重启Windsurf').then((choice) => {
          if (choice === '重启Windsurf') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        });
      } else {
        vscode.window.showErrorMessage(result?.message || '配置失败');
      }
      viewProvider?.updateStatus();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('turn-mcp.clearConfig', async () => {
      const confirm = await vscode.window.showWarningMessage(
        '确定要清除Turn MCP的所有配置吗？',
        { modal: true },
        '确定清除'
      );
      if (confirm === '确定清除') {
        const result = await serverManager?.clearMCPConfig();
        if (result?.success) {
          vscode.window.showInformationMessage(result.message, '重启Windsurf').then((choice) => {
            if (choice === '重启Windsurf') {
              vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
          });
        } else {
          vscode.window.showErrorMessage(result?.message || '清除失败');
        }
        viewProvider?.updateStatus();
      }
    })
  );

  // 自动启动服务器
  serverManager.start().then(() => {
    viewProvider?.updateStatus();
    vscode.window.showInformationMessage('Turn MCP 服务器已启动');
  });
}

export function deactivate() {
  serverManager?.stop();
  console.log('Turn MCP 插件已停用');
}
