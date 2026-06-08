package com.opencode.launcher;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public class MainActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (isTermuxInstalled()) {
            launchOpenCode();
        } else {
            showInstallTermux();
        }
    }

    private boolean isTermuxInstalled() {
        try {
            getPackageManager().getPackageInfo("com.termux", 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    private void launchOpenCode() {
        try {
            Intent intent = new Intent("com.termux.RUN_COMMAND");
            intent.setClassName("com.termux", "com.termux.app.RunCommandService");
            intent.putExtra("com.termux.RUN_COMMAND_PATH",
                "/data/data/com.termux/files/usr/bin/opencode");
            intent.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[0]);
            intent.putExtra("com.termux.RUN_COMMAND_WORKDIR", "~/");
            startService(intent);
        } catch (Exception e) {
            TextView tv = new TextView(this);
            tv.setText("Error al iniciar opencode.\n" +
                "Asegurate de:\n" +
                "1. Abrir Termux al menos una vez\n" +
                "2. Tener \"allow-external-apps=true\"\n" +
                "   en ~/.termux/termux.properties\n" +
                "3. Tener opencode instalado:\n" +
                "   npm install -g opencode-ai@latest");
            tv.setTextSize(16);
            tv.setPadding(32, 32, 32, 32);
            tv.setGravity(Gravity.CENTER_VERTICAL);
            setContentView(tv);
        }
        finish();
    }

    private void showInstallTermux() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(32, 32, 32, 32);
        layout.setGravity(Gravity.CENTER);

        TextView msg = new TextView(this);
        msg.setText("Instalá Termux desde F-Droid\npara usar OpenCode");
        msg.setTextSize(18);
        msg.setGravity(Gravity.CENTER);
        layout.addView(msg);

        Button btn = new Button(this);
        btn.setText("Abrir F-Droid");
        btn.setOnClickListener(v -> {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setData(Uri.parse("https://f-droid.org/packages/com.termux/"));
            startActivity(intent);
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = 24;
        btn.setLayoutParams(lp);
        layout.addView(btn);

        setContentView(layout);
    }
}
