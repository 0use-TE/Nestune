using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace Nestune;

public partial class App : Application
{
    private Mutex? instance;
    private const string Home = "https://music.0use.net/";
    private static bool Trusted(string uri) => Uri.TryCreate(uri, UriKind.Absolute, out var u)
        && u.Scheme == "https" && u.Host.Equals("music.0use.net", StringComparison.OrdinalIgnoreCase) && u.IsDefaultPort;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        bool check = e.Args.Contains("--check");
        if (!check)
        {
            instance = new Mutex(true, "Local\\NestuneDesktop", out bool created);
            if (!created)
            {
                foreach (var process in Process.GetProcessesByName("Nestune"))
                    if (process.Id != Process.GetCurrentProcess().Id && process.MainWindowHandle != IntPtr.Zero)
                    { ShowWindow(process.MainWindowHandle, 9); SetForegroundWindow(process.MainWindowHandle); break; }
                Shutdown(); return;
            }
        }
        var window = new Window
        {
            Title = "Nestune", Width = 1180, Height = 800, MinWidth = 390, MinHeight = 600,
            Icon = new BitmapImage(new Uri("pack://application:,,,/Assets/Nestune.ico")),
            WindowStartupLocation = WindowStartupLocation.CenterScreen,
            Background = new SolidColorBrush(Color.FromRgb(15, 15, 14)),
            Opacity = check ? 0 : 1, ShowInTaskbar = !check, ShowActivated = !check,
        };
        var browser = new WebView2 { DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 15, 15, 14) };
        window.Content = browser;
        window.Loaded += async (_, _) =>
        {
            try
            {
                string profile = check ? Path.Combine(Path.GetTempPath(), "Nestune-check-" + Guid.NewGuid())
                    : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Nestune", "WebView2");
                var environment = await CoreWebView2Environment.CreateAsync(null, profile);
                await browser.EnsureCoreWebView2Async(environment);
                var core = browser.CoreWebView2;
                core.Settings.UserAgent += " NestuneDesktop/1.0.0";
                core.Settings.AreDevToolsEnabled = check;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.AreHostObjectsAllowed = false;
                core.NavigationStarting += (_, args) =>
                {
                    if (Trusted(args.Uri) || args.Uri == "about:blank") return;
                    args.Cancel = true;
                    if (args.IsUserInitiated) OpenExternal(args.Uri);
                };
                core.NewWindowRequested += (_, args) =>
                {
                    args.Handled = true;
                    if (!args.IsUserInitiated) return;
                    if (Trusted(args.Uri)) core.Navigate(args.Uri); else OpenExternal(args.Uri);
                };
                core.PermissionRequested += (_, args) =>
                {
                    // No native bridge or automatic access to the microphone, camera or location.
                    args.State = Trusted(args.Uri) && args.PermissionKind is CoreWebView2PermissionKind.FileReadWrite or CoreWebView2PermissionKind.Autoplay
                        ? CoreWebView2PermissionState.Default : CoreWebView2PermissionState.Deny;
                };
                core.NavigationCompleted += async (_, args) =>
                {
                    if (check)
                    {
                        await Task.Delay(2500);
                        var report = await core.ExecuteScriptAsync("JSON.stringify({url:location.href,title:document.title,secure:isSecureContext,desktop:navigator.userAgent.includes('NestuneDesktop/'),installReminder:!!document.querySelector('.pwa-intro')})");
                        var json = new JavaScriptSerializer();
                        File.WriteAllText(Path.Combine(Path.GetTempPath(), "nestune-windows-check.json"), json.Serialize(new { success = args.IsSuccess, windowIcon = window.Icon != null, report = json.Deserialize<string>(report) }));
                        Shutdown(args.IsSuccess ? 0 : 1); return;
                    }
                    if (!args.IsSuccess) ShowConnectionError(window, browser);
                };
                core.Navigate(Home);
            }
            catch (Exception error)
            {
                if (check)
                {
                    File.WriteAllText(Path.Combine(Path.GetTempPath(), "nestune-windows-check.json"), new JavaScriptSerializer().Serialize(new { success = false, error = error.Message }));
                    Shutdown(1); return;
                }
                MessageBox.Show("无法打开 Nestune。请确认已安装 Microsoft Edge WebView2 运行环境。\n\n" + error.Message, "Nestune", MessageBoxButton.OK, MessageBoxImage.Information);
                Shutdown(1);
            }
        };
        window.Closed += (_, _) => { browser.Dispose(); instance?.Dispose(); };
        MainWindow = window;
        window.Show();
    }

    private static void ShowConnectionError(Window window, WebView2 browser)
    {
        var panel = new StackPanel { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center };
        panel.Children.Add(new TextBlock { Text = "暂时无法连接", Foreground = Brushes.White, FontSize = 26, Margin = new Thickness(12) });
        panel.Children.Add(new TextBlock { Text = "请检查网络连接后重试。", Foreground = Brushes.LightGray, Margin = new Thickness(12) });
        var retry = new Button { Content = "重新连接", Padding = new Thickness(24, 10, 24, 10), Margin = new Thickness(12) };
        retry.Click += (_, _) => { window.Content = browser; browser.CoreWebView2.Navigate(Home); };
        panel.Children.Add(retry);
        window.Content = panel;
    }

    private static void OpenExternal(string uri)
    {
        if (Uri.TryCreate(uri, UriKind.Absolute, out var target) && target.Scheme == "https")
            try { Process.Start(new ProcessStartInfo(target.AbsoluteUri) { UseShellExecute = true }); } catch { }
    }

    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr handle, int command);
}
