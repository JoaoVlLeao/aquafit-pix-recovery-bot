import express from "express";
import bodyParser from "body-parser";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
import chalk from "chalk";

const { Client, LocalAuth, MessageMedia } = pkg;

const app = express();
app.use(bodyParser.json());

// ===========================
// INICIALIZA WHATSAPP
// ===========================
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: "./session",
  }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--single-process",
      "--renderer-process-limit=1",
    ],
  },
});

// Controla frequência de exibição do QR code (a cada 2 minutos)
let lastQRTime = 0;
client.on("qr", (qr) => {
  const now = Date.now();
  if (now - lastQRTime < 120000) return;
  lastQRTime = now;

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
  console.log(chalk.cyan("\n📱 Escaneie o QR code no navegador:"));
  console.log(chalk.yellow(qrUrl));
  console.log(chalk.gray("💚 Após escanear, aguarde alguns segundos até conectar..."));
});

client.on("ready", () => {
  console.log(chalk.green("✅ WhatsApp conectado e pronto!"));
});

client.initialize();

// ===========================
// GERENCIAMENTO DE PEDIDOS
// ===========================
const pendingOrders = new Map(); // armazena pedidos pendentes

// ===========================
// FUNÇÃO PARA ENVIAR MENSAGEM
// ===========================
async function sendPixReminder(phone, name, order, total) {
  try {
    const formatted = phone.replace(/\D/g, "");
    const numberId = await client.getNumberId(formatted);
    if (!numberId) {
      console.log(chalk.red(`⚠️ O número ${phone} não tem WhatsApp.`));
      return;
    }

    const chat = await client.getChatById(numberId._serialized);
    const message = `Eiii *${name}*, obrigado pela sua compra! 💚  
Fico muito feliz em ter você como cliente *AquaFit Brasil* 🩷  

Meu nome é *Carolina* e percebi que o pagamento via *Pix* ainda não foi concluído, você teve algum problema?

Caso prefira, você pode pagar o valor de *R$${total}* enviando o Pix direto para nossa chave abaixo 👇  

💸 *Chave Pix CNPJ:* 52757947000145  
🏢 *Quem receberá:* JVL NEGÓCIOS DIGITAIS LTDA (Razão social da AquaFit Brasil)

Assim que enviar, me encaminhe o comprovante por aqui mesmo pra eu atualizar o sistema rapidinho 💚  
Qualquer dúvida, estou à disposição 😉`;

    await chat.sendMessage(message);
    console.log(chalk.green(`✅ Mensagem de recuperação enviada para ${name} (${phone})`));
  } catch (err) {
    console.error(chalk.red("❌ Erro ao enviar mensagem:"), err.message);
  }
}

// ===========================
// ENDPOINT /shopify
// ===========================
app.post("/shopify", async (req, res) => {
  try {
    const data = req.body;

    const name = data.customer?.first_name || "Cliente";
    const phone =
      data.billing_address?.phone ||
      data.shipping_address?.phone ||
      data.customer?.phone ||
      null;

    const financialStatus = data.financial_status || "não informado";
    const paymentMethod = data.gateway || "não informado";
    const orderName = data.name || "sem nome";
    const total = data.total_price || "0.00";

    console.log(chalk.yellow("\n🔔 NOVO WEBHOOK RECEBIDO ---------------------"));
    console.log(`🧾 Pedido: ${orderName}`);
    console.log(`💰 Status financeiro: ${financialStatus}`);
    console.log(`💳 Método de pagamento: ${paymentMethod}`);
    console.log(`👤 Cliente: ${name}`);
    console.log(`📞 Telefone: ${phone || "não informado"}`);
    console.log("------------------------------------------------");

    // Ignora se não tiver telefone
    if (!phone) {
      console.log(chalk.red(`❌ Pedido ${orderName} sem telefone — ignorado.`));
      return res.status(200).send("Sem telefone");
    }

    // Se for pago → cancela qualquer agendamento anterior
    if (financialStatus === "paid") {
      if (pendingOrders.has(orderName)) {
        clearTimeout(pendingOrders.get(orderName));
        pendingOrders.delete(orderName);
        console.log(chalk.green(`✅ Pedido ${orderName} pago — lembrete cancelado.`));
      } else {
        console.log(chalk.gray(`⚠️ Pedido ${orderName} pago — nenhum lembrete pendente.`));
      }
      return res.status(200).send("Pagamento confirmado");
    }

    // Se for pendente → agenda envio em 10 minutos
    if (financialStatus === "pending") {
      if (pendingOrders.has(orderName)) {
        console.log(chalk.gray(`⏳ Pedido ${orderName} já agendado, ignorando duplicata.`));
        return res.status(200).send("Já agendado");
      }

      console.log(chalk.blue(`🕒 Aguardando 10 minutos antes de enviar mensagem para ${phone}...`));

      const timeout = setTimeout(() => {
        sendPixReminder(phone, name, orderName, total);
        pendingOrders.delete(orderName);
      }, 10 * 60 * 1000);

      pendingOrders.set(orderName, timeout);
      return res.status(200).send("Agendado para envio em 10 minutos");
    }

    console.log(chalk.gray(`⚠️ Pedido ${orderName} ignorado (status: ${financialStatus})`));
    res.status(200).send("Ignorado");
  } catch (err) {
    console.error(chalk.red("❌ Erro ao processar webhook:"), err);
    res.status(500).send("Erro interno");
  }
});

// ===========================
// RESPOSTA AUTOMÁTICA
// ===========================
client.on("message", async (msg) => {
  try {
    if (msg.fromMe || !msg.body || msg.body === "undefined" || msg.body.trim().length === 0) return;

    const contato = msg._data?.notifyName || msg.from.split("@")[0];
    console.log(chalk.yellow(`💬 Mensagem recebida de ${contato}: ${msg.body}`));

    const resposta = `💬 Oi *${contato.split(" ")[0]}*! Tudo bem?  
Esse número é usado apenas para *mensagens automáticas* da *AquaFit Brasil*.  

📞 Para falar com nossa equipe humana, mande mensagem para:  
➡️ *+55 (19) 98773-6747* 💚`;

    await msg.reply(resposta);
    console.log(chalk.green(`🤖 Resposta automática enviada para ${contato}`));
  } catch (err) {
    console.error(chalk.red("❌ Erro ao responder mensagem:"), err);
  }
});

// ===========================
// SERVIDOR
// ===========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(chalk.blue(`🌐 Servidor rodando na porta ${PORT}`)));
