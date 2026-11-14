package br.com.aluminiojr.statusvideos;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.widget.MediaController;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.VideoView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Recebe ACTION_SEND (video/*) da galeria e publica na API existente. */
public final class MainActivity extends Activity {
    private static final int PICK_VIDEO = 41;
    private static final long MAX_BYTES = 250L * 1024 * 1024;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final List<Product> products = new ArrayList<>();
    private final LinkedHashMap<Integer, Integer> chosen = new LinkedHashMap<>();
    private StatusApi api;
    private Uri videoUri;
    private String mime = "video/mp4";
    private long videoBytes = -1;
    private boolean videoValid, loggedIn, busy;
    private String requestId;
    private VideoView preview;
    private TextView videoInfo, authInfo, state, selectedSummary;
    private EditText username, password, search;
    private Button loginButton, publishButton, statusButton;
    private LinearLayout loginSection, kitSection, productList;
    private Spinner typeSpinner;

    static final class Product {
        final int id;
        final String name;
        final double price;
        Product(int id, String name, double price) {
            this.id = id; this.name = name; this.price = price;
        }
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        api = new StatusApi(this);
        buildUi();
        handleShare(getIntent());
        verifySession();
    }

    @Override public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShare(intent);
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private LinearLayout column() {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        return c;
    }

    private TextView text(String s, int size) {
        TextView t = new TextView(this);
        t.setText(s); t.setTextSize(size); t.setTextColor(0xff243345);
        return t;
    }

    private void add(LinearLayout parent, View child, int top) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
        p.topMargin = dp(top);
        parent.addView(child, p);
    }

    private Button button(String title) {
        Button b = new Button(this);
        b.setText(title);
        b.setAllCaps(false);
        return b;
    }

    private EditText edit(String hint) {
        EditText e = new EditText(this);
        e.setTextSize(15);
        e.setSingleLine(true);
        e.setHint(hint);
        return e;
    }

    private LinearLayout panel(LinearLayout root) {
        LinearLayout p = column();
        p.setPadding(dp(16), dp(16), dp(16), dp(16));
        p.setBackgroundColor(0xffffffff);
        add(root, p, 12);
        return p;
    }

    private void buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(0xffeef2f6);
        setContentView(scroll);
        LinearLayout root = column();
        root.setPadding(dp(12), dp(8), dp(12), dp(24));
        scroll.addView(root);

        LinearLayout header = panel(root);
        TextView h = text("Alumínio JR", 23);
        h.setTextColor(0xff092743);
        h.setTypeface(null, 1);
        add(header, h, 0);
        add(header, text("Status Vídeos · Compartilhar da galeria", 13), 3);

        LinearLayout video = panel(root);
        TextView hv = text("Vídeo selecionado", 18);
        hv.setTypeface(null, 1);
        add(video, hv, 0);
        preview = new VideoView(this);
        LinearLayout.LayoutParams vp = new LinearLayout.LayoutParams(-1, dp(270));
        vp.topMargin = dp(9);
        video.addView(preview, vp);
        preview.setBackgroundColor(0xff0e0e0e);
        preview.setMediaController(new MediaController(this));
        videoInfo = text("Use Compartilhar na galeria ou escolha um vídeo.", 13);
        add(video, videoInfo, 8);
        Button pick = button("Escolher outro vídeo");
        add(video, pick, 8);
        pick.setOnClickListener(v -> pickVideo());

        LinearLayout selection = panel(root);
        TextView hs = text("Tipo de publicação", 18);
        hs.setTypeface(null, 1);
        add(selection, hs, 0);
        typeSpinner = new Spinner(this);
        String[] types = {"Kit feirinha", "Vídeo promocional"};
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this,
            android.R.layout.simple_spinner_dropdown_item, types);
        typeSpinner.setAdapter(adapter);
        typeSpinner.setSelection(1);
        add(selection, typeSpinner, 8);
        add(selection, text("Promocional: sem preços, quantidade ou kit no rodapé. " +
            "Kit feirinha: escolha os produtos e quantidades.", 13), 8);
        kitSection = column();
        add(selection, kitSection, 10);
        search = edit("Buscar produto do kit");
        add(kitSection, search, 0);
        selectedSummary = text("Nenhum produto selecionado.", 13);
        add(kitSection, selectedSummary, 8);
        productList = column();
        add(kitSection, productList, 7);
        typeSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> p, View v, int pos, long id) {
                kitSection.setVisibility(pos == 0 ? View.VISIBLE : View.GONE);
                refreshPublish();
            }
            @Override public void onNothingSelected(AdapterView<?> p) { }
        });
        search.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int st, int c, int a) {}
            @Override public void onTextChanged(CharSequence s, int st, int before, int count) {
                renderProducts();
            }
            @Override public void afterTextChanged(Editable e) {}
        });

        loginSection = panel(root);
        TextView hl = text("Acesso administrativo", 18);
        hl.setTypeface(null, 1);
        add(loginSection, hl, 0);
        username = edit("Usuário");
        add(loginSection, username, 8);
        password = edit("Senha");
        password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        add(loginSection, password, 8);
        loginButton = button("Entrar");
        add(loginSection, loginButton, 8);
        loginButton.setOnClickListener(v -> login());

        LinearLayout footer = panel(root);
        authInfo = text("Verificando sessão...", 13);
        add(footer, authInfo, 0);
        publishButton = button("Gerar vídeo e publicar nas redes");
        add(footer, publishButton, 10);
        publishButton.setOnClickListener(v -> publish());
        statusButton = button("Consultar última publicação");
        add(footer, statusButton, 8);
        statusButton.setVisibility(View.GONE);
        statusButton.setOnClickListener(v -> pollStatus());
        state = text("O envio só começa quando você tocar em Publicar.", 14);
        add(footer, state, 10);
        add(footer, text("Destinos: WhatsApp Status, Instagram Story, Facebook Story, " +
            "Facebook Feed e YouTube Shorts.", 12), 10);
        refreshPublish();
    }

    private void pickVideo() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("video/*");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(i, PICK_VIDEO);
    }

    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == PICK_VIDEO && result == RESULT_OK && data != null && data.getData() != null) {
            try {
                getContentResolver().takePersistableUriPermission(data.getData(),
                    Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception ignored) { }
            setVideo(data.getData(), data.getType());
        }
    }

    @SuppressWarnings("deprecation")
    private void handleShare(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        Uri uri = Build.VERSION.SDK_INT >= 33
            ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class)
            : intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri == null && intent.getClipData() != null && intent.getClipData().getItemCount() > 0) {
            uri = intent.getClipData().getItemAt(0).getUri();
        }
        if (uri != null && (intent.getType() == null || intent.getType().startsWith("video/"))) {
            setVideo(uri, intent.getType());
        }
    }

    private long fileSize(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.SIZE},
                null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getLong(0);
        } catch (Exception ignored) { }
        return -1;
    }

    private void setVideo(Uri uri, String type) {
        if (busy) {
            state.setText("Espere o envio atual terminar antes de trocar de vídeo.");
            return;
        }
        videoUri = uri;
        mime = type != null && type.startsWith("video/") ? type : getContentResolver().getType(uri);
        if (mime == null || !mime.startsWith("video/")) mime = "video/mp4";
        requestId = null;
        statusButton.setVisibility(View.GONE);
        videoBytes = -1;
        videoValid = false;
        preview.setVideoURI(uri);
        videoInfo.setText("Lendo vídeo...");
        state.setText("Vídeo recebido. Escolha o tipo e publique.");
        refreshPublish();
        io.execute(() -> {
            long bytes = fileSize(uri);
            long seconds = -1;
            MediaMetadataRetriever retriever = new MediaMetadataRetriever();
            try {
                retriever.setDataSource(this, uri);
                String ms = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
                if (ms != null) seconds = Math.round(Double.parseDouble(ms) / 1000);
            } catch (Exception ignored) { }
            finally { retriever.release(); }
            long finalSeconds = seconds;
            ui.post(() -> {
                if (!uri.equals(videoUri)) return;
                videoBytes = bytes;
                boolean sizeOk = bytes < 0 || bytes <= MAX_BYTES;
                boolean durationOk = finalSeconds < 0 || (finalSeconds >= 3 && finalSeconds <= 55);
                videoValid = sizeOk && durationOk;
                String info = bytes < 0 ? "Tamanho desconhecido" :
                    String.format(Locale.getDefault(), "%.1f MB", bytes / 1048576.0);
                if (finalSeconds >= 0) info += " · " + finalSeconds + " segundos";
                if (!sizeOk) info += "\nVídeo acima de 250 MB.";
                if (!durationOk) info += "\nDuração aceita: 3 a 55 segundos.";
                videoInfo.setText(info);
                refreshPublish();
            });
        });
    }

    private void verifySession() {
        io.execute(() -> {
            try {
                boolean ok = api.checkSession();
                ui.post(() -> {
                    loggedIn = ok;
                    authInfo.setText(ok ? "Sessão administrativa ativa." : "Entre para publicar.");
                    loginSection.setVisibility(ok ? View.GONE : View.VISIBLE);
                    refreshPublish();
                    if (ok) loadProducts();
                });
            } catch (Exception e) {
                ui.post(() -> {
                    loggedIn = false;
                    loginSection.setVisibility(View.VISIBLE);
                    authInfo.setText("Sem sessão: " + e.getMessage());
                    refreshPublish();
                });
            }
        });
    }

    private void login() {
        String user = username.getText().toString().trim();
        String pass = password.getText().toString();
        if (user.isEmpty() || pass.isEmpty()) {
            authInfo.setText("Informe usuário e senha.");
            return;
        }
        loginButton.setEnabled(false);
        authInfo.setText("Autenticando...");
        io.execute(() -> {
            try {
                api.login(user, pass);
                ui.post(() -> {
                    loggedIn = true;
                    password.setText("");
                    loginSection.setVisibility(View.GONE);
                    authInfo.setText("Sessão administrativa ativa.");
                    loginButton.setEnabled(true);
                    refreshPublish();
                    loadProducts();
                });
            } catch (Exception e) {
                ui.post(() -> {
                    loginButton.setEnabled(true);
                    authInfo.setText("Não foi possível entrar: " + e.getMessage());
                });
            }
        });
    }

    private void loadProducts() {
        io.execute(() -> {
            try {
                JSONArray data = api.products();
                List<Product> loaded = new ArrayList<>();
                if (data != null) for (int i = 0; i < data.length(); i++) {
                    JSONObject p = data.optJSONObject(i);
                    if (p == null) continue;
                    int id = p.optInt("id");
                    double price = p.optDouble("preco", 0);
                    String name = p.optString("nome", "");
                    if (id > 0 && price > 0 && !name.isEmpty()) {
                        loaded.add(new Product(id, name, price));
                    }
                }
                loaded.sort((a, b) -> a.name.compareToIgnoreCase(b.name));
                ui.post(() -> {
                    products.clear();
                    products.addAll(loaded);
                    renderProducts();
                });
            } catch (Exception e) {
                ui.post(() -> selectedSummary.setText("Erro ao carregar produtos: " + e.getMessage()));
            }
        });
    }

    private void renderProducts() {
        if (productList == null) return;
        productList.removeAllViews();
        if (products.isEmpty()) {
            add(productList, text("Produtos disponíveis após entrar.", 13), 4);
            return;
        }
        String term = search.getText().toString().trim().toLowerCase(Locale.ROOT);
        int shown = 0;
        for (Product p : products) {
            if (!term.isEmpty() && !p.name.toLowerCase(Locale.ROOT).contains(term) && !chosen.containsKey(p.id)) continue;
            if (shown++ >= 60) break;
            LinearLayout row = column();
            row.setPadding(dp(4), dp(4), dp(4), dp(7));
            add(productList, row, 3);
            CheckBox check = new CheckBox(this);
            check.setText(p.name + "  ·  R$ " + String.format(Locale.forLanguageTag("pt-BR"), "%.2f", p.price));
            check.setTextSize(13);
            check.setChecked(chosen.containsKey(p.id));
            add(row, check, 0);
            EditText qty = edit("Quantidade");
            qty.setInputType(InputType.TYPE_CLASS_NUMBER);
            qty.setText(String.valueOf(chosen.getOrDefault(p.id, 1)));
            qty.setVisibility(check.isChecked() ? View.VISIBLE : View.GONE);
            add(row, qty, 0);
            check.setOnCheckedChangeListener((button, selected) -> {
                if (selected) chosen.put(p.id, parseQuantity(qty.getText().toString()));
                else chosen.remove(p.id);
                qty.setVisibility(selected ? View.VISIBLE : View.GONE);
                refreshPublish();
            });
            qty.addTextChangedListener(new TextWatcher() {
                @Override public void beforeTextChanged(CharSequence s, int st, int c, int a) {}
                @Override public void onTextChanged(CharSequence s, int st, int before, int count) {
                    if (chosen.containsKey(p.id)) chosen.put(p.id, parseQuantity(s.toString()));
                    refreshPublish();
                }
                @Override public void afterTextChanged(Editable e) {}
            });
        }
        if (shown >= 60) add(productList, text("Exibindo até 60 produtos. Use a busca para localizar outros.", 12), 6);
        refreshPublish();
    }

    private int parseQuantity(String s) {
        try { return Math.max(1, Math.min(999, Integer.parseInt(s))); }
        catch (Exception ignored) { return 1; }
    }

    private boolean promotional() { return typeSpinner != null && typeSpinner.getSelectedItemPosition() == 1; }

    private void refreshPublish() {
        if (selectedSummary != null) {
            double total = 0;
            int count = 0;
            for (Product p : products) {
                int qty = chosen.getOrDefault(p.id, 0);
                count += qty;
                total += qty * p.price;
            }
            selectedSummary.setText(count + " itens no kit · R$ " +
                String.format(Locale.forLanguageTag("pt-BR"), "%.2f", total));
        }
        if (publishButton != null) {
            publishButton.setEnabled(videoUri != null && videoValid && loggedIn && !busy &&
                requestId == null && (promotional() || !chosen.isEmpty()));
        }
        if (statusButton != null) statusButton.setEnabled(!busy);
    }

    private JSONArray selectedItems() throws Exception {
        JSONArray result = new JSONArray();
        if (!promotional()) for (Map.Entry<Integer, Integer> entry : chosen.entrySet()) {
            result.put(new JSONObject().put("produto_id", entry.getKey())
                .put("quantidade", entry.getValue()));
        }
        return result;
    }

    private void publish() {
        if (busy || !videoValid || !loggedIn || videoUri == null || requestId != null) return;
        if (!promotional() && chosen.isEmpty()) return;
        JSONArray items;
        try { items = selectedItems(); }
        catch (Exception e) { state.setText(e.getMessage()); return; }
        String type = promotional() ? "promocional" : "kit_feirinha";
        String id = "android-" + UUID.randomUUID();
        Uri uri = videoUri;
        String selectedMime = mime;
        long size = videoBytes;
        requestId = id;
        statusButton.setVisibility(View.VISIBLE);
        busy = true;
        refreshPublish();
        state.setText("Enviando arquivo ao servidor. Mantenha o aplicativo aberto.");
        io.execute(() -> {
            try {
                api.upload(this, uri, selectedMime, type, items, id, size, (sent, total) -> {
                    ui.post(() -> {
                        if (total > 0) {
                            int pct = (int) Math.min(100, sent * 100 / total);
                            state.setText("Enviando vídeo: " + pct + "%");
                        } else {
                            state.setText("Enviando vídeo: " + (sent / 1048576) + " MB");
                        }
                    });
                });
                ui.post(() -> state.setText("Vídeo recebido. Processando e publicando nas redes..."));
                pollStatusOnWorker(id);
            } catch (Exception e) {
                ui.post(() -> {
                    busy = false;
                    state.setText("Não foi possível confirmar o envio: " + e.getMessage() +
                        "\nNão envie novamente antes de consultar a publicação.");
                    refreshPublish();
                });
            }
        });
    }

    private void pollStatus() {
        if (busy || requestId == null) return;
        busy = true;
        refreshPublish();
        String id = requestId;
        state.setText("Consultando publicação...");
        io.execute(() -> pollStatusOnWorker(id));
    }

    private void pollStatusOnWorker(String id) {
        try {
            for (int i = 0; i < 300; i++) {
                if (Thread.currentThread().isInterrupted()) return;
                JSONObject job = api.status(id);
                String status = job.optString("status", "");
                if ("concluido".equals(status)) {
                    JSONObject result = job.optJSONObject("resultado");
                    if (result == null) throw new Exception("Servidor concluiu sem detalhar os canais.");
                    ui.post(() -> {
                        state.setText(formatResult(result));
                        busy = false;
                        refreshPublish();
                    });
                    return;
                }
                if ("erro".equals(status)) {
                    throw new Exception(job.optString("erro", "Erro ao processar vídeo."));
                }
                final String description = "aguardando".equals(status)
                    ? "Vídeo na fila de processamento."
                    : "Processando e publicando. Consulta automática em andamento.";
                ui.post(() -> state.setText(description));
                Thread.sleep(3000);
            }
            throw new Exception("Tempo de consulta encerrado. Use Consultar última publicação.");
        } catch (Exception e) {
            ui.post(() -> {
                busy = false;
                state.setText("Acompanhamento interrompido: " + e.getMessage() +
                    "\nCódigo: " + id + ". Consulte a publicação antes de reenviar.");
                if (e.getMessage() != null && e.getMessage().contains("Sessão expirada")) {
                    loggedIn = false;
                    loginSection.setVisibility(View.VISIBLE);
                }
                refreshPublish();
            });
        }
    }

    private String formatResult(JSONObject result) {
        JSONObject channels = result.optJSONObject("canais");
        if (channels == null) return "Processamento concluído, mas sem detalhes dos canais.";
        String[][] names = {
            {"whatsapp", "WhatsApp Status"},
            {"instagram_story", "Instagram Story"},
            {"facebook_story", "Facebook Story"},
            {"facebook_feed", "Facebook Feed"},
            {"youtube_shorts", "YouTube Shorts"}
        };
        StringBuilder message = new StringBuilder("Resultado: ")
            .append(result.optString("status_geral", "desconhecido")).append("\n");
        for (String[] item : names) {
            JSONObject channel = channels.optJSONObject(item[0]);
            String status = channel == null ? "sem retorno" : channel.optString("status", "desconhecido");
            message.append("\n").append(item[1]).append(": ").append(status);
            if (channel != null && "erro".equals(status)) {
                message.append(" · ").append(channel.optString("erro", "erro não detalhado"));
            }
        }
        return message.toString();
    }

    @Override protected void onDestroy() {
        io.shutdownNow();
        super.onDestroy();
    }
}
