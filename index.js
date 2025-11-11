import express from "express";
import bodyParser from "body-parser";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
import chalk from "chalk";

const { Client, LocalAuth } = pkg;

const app = express();
app.use(bodyParser.json());

// ----------------------
// INICIALIZA WHATSAPP
// ----------------------
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: "./session_pix", // sessão separada
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

client.on("qr", (qr) => {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
    qr
  )}`;
  console.log(chalk.cyan("\n📱 Escaneie o QR code no navegador:"));
  console.log(chalk.yellow(qrUrl));
  console.log(chalk.gray("💚 Após escanear, aguarde até a conexão ser estabelecida...\n"));
});

client.on("ready", () => {
  console.log(chalk.green("✅ WhatsApp conectado e pronto para recuperação de Pix!"));
});

client.initialize();

// ----------------------
// FILA DE MENSAGENS
// ----------------------
const messageQueue = [];
let isProcessing = false;

async function processQueue() {
  if (isProcessing || messageQueue.length === 0) return;

  isProcessing = true;
  const { phone, message } = messageQueue.shift();

  try {
    const formatted = phone.replace(/\D/g, "");
    const numberId = await client.getNumberId(formatted);

    if (!numberId) {
      console.log(chalk.red(`⚠️ O número ${phone} não tem WhatsApp.`));
      isProcessing = false;
      return;
    }

    const chat = await client.getChatById(numberId._serialized);
    await chat.sendMessage(message);
    console.log(chalk.green(`✅ Mensagem enviada para ${phone}`));
  } catch (err) {
    console.error(chalk.red("❌ Erro ao enviar mensagem:"), err);
  }

  setTimeout(() => {
    isProcessing = false;
    processQueue();
  }, 5 * 60 * 1000); // 5 min entre mensagens (anti-ban)
}

// ----------------------
// MONITORA PEDIDOS (10 min delay)
// ----------------------
const pendingOrders = new Map(); // armazena pedidos Pix pendentes

app.post("/shopify", async (req, res) => {
  try {
    const data = req.body;

    console.log(chalk.yellow("\n🔔 NOVO WEBHOOK RECEBIDO ---------------------"));
    console.log(`🧾 Pedido: ${data.name}`);
    console.log(`💰 Status financeiro: ${data.financial_status}`);
    console.log(`💳 Método de pagamento: ${data.gateway}`);
    console.log(`👤 Cliente: ${data.customer?.first_name || "não informado"}`);

    const phone =
      data.billing_address?.phone ||
      data.shipping_address?.phone ||
      data.customer?.phone ||
      data.phone ||
      null;

    console.log(`📞 Telefone: ${phone || "não informado"}`);
    console.log("------------------------------------------------");

    // SE O PEDIDO FOR PAGO — remove da fila, se existir
    if (data.financial_status === "paid") {
      if (pendingOrders.has(data.name)) {
        clearTimeout(pendingOrders.get(data.name));
        pendingOrders.delete(data.name);
        console.log(chalk.green(`✅ Pedido ${data.name} foi pago — envio cancelado.`));
      } else {
        console.log(chalk.gray(`💚 Pedido ${data.name} pago — nada pendente.`));
      }
      return res.status(200).send("Pagamento confirmado, sem ação necessária.");
    }

    // SE O PEDIDO FOR PIX PENDENTE — agenda para checar em 10 minutos
    if (data.gateway === "pix" && data.financial_status === "pending" && phone) {
      console.log(chalk.magenta(`⏳ Pedido ${data.name} via Pix pendente — aguardando 10 minutos...`));

      const timeout = setTimeout(async () => {
        // Se ainda estiver pendente (não cancelado nem pago)
        if (!pendingOrders.has(data.name)) return;

        const message = `Eiii *${
          data.customer?.first_name || "cliente"
        }*, obrigado pela sua compra, fico muito feliz em ter você como cliente *AquaFit Brasil* 🩷💚

Meu nome é *Carolina* e percebi que o pagamento via *Pix* ainda não foi feito, você teve algum problema?

Caso prefira e ache mais fácil, você pode fazer o *pix* no valor de *R$${data.total_price}* do seu pedido e encaminhar o comprovante por aqui mesmo para que eu atualize no sistema.

*Chave Pix CNPJ:* 52757947000145  
*Quem receberá:* JVL NEGÓCIOS DIGITAIS LTDA — (Razão social da empresa AquaFit Brasil)

Caso tenha tido alguma dúvida em relação ao pedido, estou à disposição 😉`;

        messageQueue.push({ phone, message });
        processQueue();

        pendingOrders.delete(data.name);
      }, 10 * 60 * 1000); // 10 minutos

      pendingOrders.set(data.name, timeout);
    }

    res.status(200).send("Webhook recebido");
  } catch (err) {
    console.error(chalk.red("❌ Erro ao processar webhook:"), err);
    res.status(500).send("Erro interno");
  }
});

// ----------------------
// RESPOSTAS AUTOMÁTICAS
// ----------------------
client.on("message", async (msg) => {
  try {
    if (msg.fromMe) return;

    if (!msg.body || msg.body.trim().length === 0 || msg.body === "undefined") return;

    const contato = msg._data?.notifyName || msg.from.split("@")[0];
    console.log(chalk.yellow(`💬 Mensagem recebida de ${contato}: ${msg.body}`));

    const resposta = `💬 Oi *${contato.split(" ")[0]}*!  
Esse número é usado apenas para mensagens automáticas.  
Para falar com nossa equipe de atendimento humano, chame:  
📞 *+55 (19) 98773-6747* 💚`;

    await msg.reply(resposta);
    console.log(chalk.green(`🤖 Resposta automática enviada para ${contato}`));
  } catch (err) {
    console.error(chalk.red("❌ Erro ao responder mensagem:"), err);
  }
});

// ----------------------
// SERVIDOR
// ----------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(chalk.blue(`🌐 Servidor rodando na porta ${PORT}`)));
