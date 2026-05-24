package com.codex.moleculebuilder;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewAssetLoader;

import com.codex.moleculebuilder.databinding.ActivityMainBinding;

public class MainActivity extends AppCompatActivity {
    private static final String PREFS_NAME = "molecule_builder_mobile";
    private static final String KEY_CONSENT = "internet_consent";
    private static final String KEY_BASE_URL = "base_url";

    private ActivityMainBinding binding;
    private SharedPreferences prefs;
    private WebViewAssetLoader assetLoader;
    private boolean pageLoadedOnce = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityMainBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        ViewCompat.setOnApplyWindowInsetsListener(binding.getRoot(), (view, windowInsets) -> {
            Insets insets = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(insets.left, insets.top, insets.right, insets.bottom);
            return windowInsets;
        });

        setSupportActionBar(binding.topAppBar);
        setupSwipeRefresh();
        configureWebView();
        configureButtons();

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (binding.webView.canGoBack()) {
                    binding.webView.goBack();
                } else {
                    finish();
                }
            }
        });

        if (hasConsent()) {
            showWebMode();
            loadHomePage(false);
        } else {
            showConsentMode();
        }
    }

    private void setupSwipeRefresh() {
        binding.swipeRefresh.setColorSchemeResources(
                R.color.accent_blue,
                R.color.accent_gold,
                R.color.accent_green
        );
        binding.swipeRefresh.setOnRefreshListener(() -> binding.webView.reload());
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        binding.webView.getSettings().setJavaScriptEnabled(true);
        binding.webView.getSettings().setDomStorageEnabled(true);
        binding.webView.getSettings().setDatabaseEnabled(true);
        binding.webView.getSettings().setAllowFileAccess(false);
        binding.webView.getSettings().setBuiltInZoomControls(false);
        binding.webView.getSettings().setDisplayZoomControls(false);
        binding.webView.getSettings().setLoadWithOverviewMode(true);
        binding.webView.getSettings().setUseWideViewPort(true);

        binding.webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return assetLoader.shouldInterceptRequest(Uri.parse(url));
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                showLoadingOverlay(pageLoadedOnce ? "Refreshing Molecule Builder..." : "Opening Molecule Builder...");
                hideError();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageLoadedOnce = true;
                binding.loadingOverlay.setVisibility(View.GONE);
                binding.swipeRefresh.setRefreshing(false);
                binding.webView.setVisibility(View.VISIBLE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showErrorState();
                }
            }
        });

        binding.webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                binding.loadingProgress.setIndeterminate(false);
                binding.loadingProgress.setProgress(newProgress);
                if (newProgress >= 100) {
                    binding.loadingProgress.setIndeterminate(true);
                }
            }
        });
    }

    private void configureButtons() {
        binding.acceptInternetButton.setOnClickListener(v -> {
            prefs.edit().putBoolean(KEY_CONSENT, true).apply();
            showWebMode();
            loadHomePage(false);
        });

        binding.configureUrlButton.setOnClickListener(v -> showUrlDialog());
        binding.retryButton.setOnClickListener(v -> loadHomePage(true));
        binding.changeUrlButton.setOnClickListener(v -> showUrlDialog());
        binding.resetUrlChip.setOnClickListener(v -> {
            prefs.edit().remove(KEY_BASE_URL).apply();
            Toast.makeText(this, "Source reset to the built-in standalone app.", Toast.LENGTH_SHORT).show();
            updateCurrentUrlText();
            pageLoadedOnce = false;
            loadHomePage(false);
        });
    }

    private void showConsentMode() {
        binding.consentContainer.setVisibility(View.VISIBLE);
        binding.swipeRefresh.setVisibility(View.GONE);
        binding.errorContainer.setVisibility(View.GONE);
        binding.loadingOverlay.setVisibility(View.GONE);
        updateCurrentUrlText();
    }

    private void showWebMode() {
        binding.consentContainer.setVisibility(View.GONE);
        binding.swipeRefresh.setVisibility(View.VISIBLE);
        binding.errorContainer.setVisibility(View.GONE);
        binding.webView.setVisibility(View.INVISIBLE);
        updateCurrentUrlText();
    }

    private void showLoadingOverlay(String message) {
        binding.loadingLabel.setText(message);
        binding.loadingOverlay.setVisibility(View.VISIBLE);
        binding.errorContainer.setVisibility(View.GONE);
    }

    private void showErrorState() {
        binding.loadingOverlay.setVisibility(View.GONE);
        binding.swipeRefresh.setRefreshing(false);
        binding.errorContainer.setVisibility(View.VISIBLE);
        binding.webView.setVisibility(View.GONE);

        String message = isOnline()
                ? "The selected source did not respond. Switch back to the built-in standalone mode or check the remote URL."
                : "No internet connection was detected. The built-in offline app should still work in standalone mode.";
        binding.errorMessage.setText(message);
    }

    private void hideError() {
        binding.errorContainer.setVisibility(View.GONE);
    }

    private void loadHomePage(boolean forceReload) {
        if (!hasConsent()) {
            showConsentMode();
            return;
        }

        showWebMode();
        showLoadingOverlay(forceReload ? "Reloading Molecule Builder..." : "Loading Molecule Builder...");

        String url = getBaseUrl();
        if (forceReload || !pageLoadedOnce) {
            binding.webView.loadUrl(url);
        } else {
            binding.webView.reload();
        }
    }

    private void updateCurrentUrlText() {
        binding.currentUrlValue.setText(getBaseUrl());
    }

    private void showUrlDialog() {
        final EditText input = new EditText(this);
        input.setText(getBaseUrl());
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        int padding = getResources().getDimensionPixelSize(R.dimen.dialog_padding);
        input.setPadding(padding, padding, padding, padding);

        new AlertDialog.Builder(this)
                .setTitle("Set source URL")
                .setMessage("The standalone app is bundled by default. Enter a hosted URL only if you want to switch to a remote copy.")
                .setView(input)
                .setPositiveButton("Save", (dialog, which) -> {
                    String value = input.getText().toString().trim();
                    if (!value.startsWith("http://") && !value.startsWith("https://")) {
                        Toast.makeText(this, "Enter a full URL starting with http:// or https://", Toast.LENGTH_LONG).show();
                        return;
                    }
                    prefs.edit().putString(KEY_BASE_URL, value).apply();
                    updateCurrentUrlText();
                    pageLoadedOnce = false;
                    loadHomePage(false);
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private boolean hasConsent() {
        return prefs.getBoolean(KEY_CONSENT, false);
    }

    private String getBaseUrl() {
        return prefs.getString(KEY_BASE_URL, BuildConfig.DEFAULT_BASE_URL);
    }

    private boolean isOnline() {
        ConnectivityManager connectivityManager =
                (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivityManager == null) {
            return false;
        }
        Network activeNetwork = connectivityManager.getActiveNetwork();
        if (activeNetwork == null) {
            return false;
        }
        NetworkCapabilities capabilities = connectivityManager.getNetworkCapabilities(activeNetwork);
        if (capabilities == null) {
            return false;
        }
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        getMenuInflater().inflate(R.menu.main_menu, menu);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        int itemId = item.getItemId();
        if (itemId == R.id.action_reload) {
            loadHomePage(true);
            return true;
        }
        if (itemId == R.id.action_edit_url) {
            showUrlDialog();
            return true;
        }
        return super.onOptionsItemSelected(item);
    }
}
