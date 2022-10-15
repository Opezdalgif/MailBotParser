const fs = require("fs");
const puppeteer = require('puppeteer');
var request = require('request');
const mysql = require("mysql2");

START_SCRIPTS();

//--------------------------------< DB >------------------------------//
//------------------------------< MOMENTS >--------------------------//
const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  database: 'mailing',
  password: ""
});

connection.connect(error => {
  // open the MySQL connection
  if (error) throw error;
  console.log("Successfully connected to the database.");
});

connection.query("SET SESSION wait_timeout = 604800");
// insert , update
async function post_info(sql) {
  return new Promise(function (resolve, reject) {
    connection.query(sql, function (err, results) {
      if (err) {
        console.log('error sql: ', sql);
        throw err;
      }
      return resolve(results.insertId);
    })
  })
}
// select , delete
async function get_data(sql) {
  return new Promise(function (resolve, reject) {
    connection.query(sql, function (err, results) {
      if (err) {
        console.log('error sql: ', sql);
        throw err;
      }
      return resolve(results);
    })
  })
}
//-----------------------------< SERVICE >---------------------------//

async function START_SCRIPTS() {

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 50, // замедляет работу браузера
    ignoreHTTPSErrors: true,
    args: [
      `--window-size=1920,1080`
    ],
    defaultViewport: {
      width: 1920,
      height: 1080
    }
  });

  var COUNT_PAGES_LISTENER = 1;

  const page = await browser.newPage();
  await page.setDefaultNavigationTimeout(0); // отключаю таймаут
  // await page.setViewport({
  //   width: 1366,
  //   height: 768,
  //   deviceScaleFactor: 1,
  // });
  await page.goto('https://roundcube.timeweb.ru/', {
    waitUntil: 'domcontentloaded',
    timeout: 0, // совсем отключил таймаут
  })

  page.on('dialog', async dialog => {
    await dialog.dismiss();
  });

  while (await page.$('#rcmloginuser') == null) {
    sleepFor(500);
  }

  await page.waitForTimeout(1000);

  await page.click('#rcmloginuser');
  await page.keyboard.sendCharacter('steelcom@s-k156.ru');
  await page.click('#rcmloginpwd');
  await page.keyboard.sendCharacter('nxZalR3nbScO');
  await page.waitForTimeout(1000);
  await page.click('#rcmloginsubmit');

  console.log('Аторизовался')

  // - - - - - - - - - - - - - - - - - - - - - - - - -
  // = = = = = = В С Ё,   Р Е З У Л Ь Т А Т.   М Ы   В   П О Ч Т Е.
  // - - - - - - - - - - - - - - - - - - - - - - - - -

  await page.waitForTimeout(3000);
  console.log('Приступаю пересматривать таблицу\n')
  await page.waitForSelector('#messagelist > tbody > tr')
  await page.click('#messagelist > tbody > tr > td.subject > span.subject > a')

  let arr_Url = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('#messagelist > tbody > tr > td.subject > span.subject > a[href]')).map(el => el.getAttribute('href'))
  })

  //Получаем из последнего письма id
  console.log("Arr_URL: ", arr_Url[0])
  let resultURL = arr_Url[0].replace("/?_task=mail&_mbox=INBOX&_uid=", "")
  resultURL = resultURL.replace("&_action=show", "")

  console.log("RESULTURL: ", resultURL)
  let NumberUrl = Number(resultURL)
  //рабочая которая собирает все майлы 
  async function mail() {

    console.log("Я в функции майл")
    const page2 = await browser.newPage();
    // let slice = arr_header[0].slice(16,65)
    // console.log("Я слайс " + slice)

    var stop = 0;
    var msg_withe_error
    for (let i = NumberUrl; i >= 0; i--) {
      await sleep(100)
      //Выборка из бд , по id . И проверка почты , если смотрели уже похожие почты больше 3х раз пропускаем 
      let get_array = await get_data("SELECT * FROM `mail` WHERE `id_mail` = '" + i + "'")
      // ДЛЯ СЕБЯ: НЕКОРРЕТКНО РАБОТАЕТ get_array.lenght!!!!! ПОЧЕМУ ?
      if (Object.keys(get_array).length > 0) {
        console.log('\nЭто уже смотрели, пропускаем. \n')
        console.log("Stop: " + stop)
        stop++;
        if (stop > 3) {
          console.log("\nМы уже смотрели последующую выдачу, завершаем работу программы.")
          return
        }
        continue
        // return
      }

      // Здесь можем проверить по ссылке

      let URL = 'https://roundcube.timeweb.ru/?_task=mail&_mbox=INBOX&_uid='+i+'&_action=show';

      try {
        await page2.goto(URL)
      } catch (e) {
        console.log('Ошибка навигации: ', e, '\n')
        continue
      }

      //Здесь мы получаем заголок письма с ошибкой
      let arr_header = await page2.evaluate(() => {
        return Array.from(document.querySelectorAll('#message-header > h2').values()).map(el => el.textContent)
      })
      //Здесь мы получаем заголовок уже удаленного письма 
      let arr_errServer = await page2.evaluate(() => {
        return Array.from(document.querySelectorAll('#layout-content > div.frame-content.scroller > div > span > h3').values()).map(el => el.textContent)
      })

      //Пропускаем то письмо которое удаленно , чтобы скрипт не останавливался 
      if (arr_errServer[0] == 'ОШИБКА СЕРВЕРА!') {
        console.log('пропустил ошибку сервера')
        continue;
      }
      msg_withe_error = await page2.evaluate(() => {
        return Array.from(document.querySelectorAll('#message-part1 > div').values()).
          map(el => el.textContent);
      });
      if (arr_header[0].indexOf('Undelivered Mail') != -1 || arr_header[0].indexOf('Mail delivery failed') != -1) {
        // ВОТ ДРУГАЯ ОШИБКА, ОНА МОЖЕТ БЫТЬ НЕ ПОСЛЕДНЯЯ, КОТОРАЯ ОТЛЧАЕТСЯ, 
        if (arr_header[0].indexOf('Undelivered Mail') != -1) {
          // Это другая ошибка, не такая, как как ниже... Тут другие селекторы. Нужно их так же отсматривать, выбирать содержимое, передавать серверу и удалять письмо
          console.log("Зашел в Underlivered mail")
          let mail = await page2.evaluate(() => {
            return Array.from(document.querySelectorAll('#message-part1 > div > a:nth-child(13)').values()).map(el => el.textContent)
          })
          console.log("Lenght ", mail.length)
          console.log("Mail", mail[0])
          if (mail.length == 0) {
            mail = await page2.evaluate(() => {
              return Array.from(document.querySelectorAll('#message-part1 > div > a').values()).map(el => el.textContent)
            })

            console.log("Mail2 ")
          }
          await checkMessage(msg_withe_error, mail[0] , page2);
          console.log('ПОЧТА MAIL: ', mail[0])
          //console.log("Причина: " + description)
          console.log('URL MAIL:' + URL)
          console.log("! ! ! ! !")
        }
        // ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ 

        //Сравнимаем полученный заголовок с надписью ошибки 
        if (arr_header[0].indexOf('Mail delivery failed') != -1) {
          console.log("Это сообщение с ошибкой.")
          let arr_mail = await page2.evaluate(() => {
            return Array.from(document.querySelectorAll('#message-part1 > div > a:nth-child(6)').values()).map(el => el.textContent)
          })
          if (arr_mail.length == 0) {
            arr_mail = await page2.evaluate(() => {
              return Array.from(document.querySelectorAll('#message-part1 > div > a').values()).map(el => el.textContent)
            })

            if (arr_mail == 0) {
              arr_mail = await page2.evaluate(() => {
                return Array.from(document.querySelectorAll('#message-part1 > div > a:nth-child(13)').values()).map(el => el.textContent)
              })
            }
          }
          if (arr_mail.length > 0) {
            console.log('Почта не найдена!!!! \n\n')
          }
          // Проверка по почте (Смотрели ли мы письмо)
          console.log('Смотрю почту: ', arr_mail[0])




          // Здесь получаем причину ошибки

          //  console.log("Error " + msg_withe_error)
          // - Э Т О  П О Ч Т А,  Н А   К О Т О Р У Ю   Н Е   Д О С Т А В Л Е Н О   П И С Ь М О
          // - Р А З Р Е Ш И М   П Р О Й Т И


          //------------------------------Здесь мы по ключевым словам определяем какая ошибка----------------//
          await checkMessage(msg_withe_error, arr_mail[0] , page2);

          //-------------------------------------------------------------------------------------------------------//
          console.log('ПОЧТА: ', arr_mail[0])
          //console.log("Причина: " + description)
          console.log('URL:' + URL)
          console.log("! ! ! ! !")
          //Если все нормикс , отправялем на сервер



          // await page2.waitForTimeout(1000)
          // await page2.click('#rcmbtn112')

        } 
        //Записыаем полученные данные в бд 
      } else {
        console.log("Это нормальное письмо, идём дальше...")
        await post_info('INSERT INTO `mail`(`id_mail`)VALUES(' + i + ')')
      }
    }
  }
  mail()


  //#messagecontframe > html > body > #layout-content > .content frame-content > #message-header >.header > #message-content > .rightcol > #messagebody > #message-part1 > .pre > a:nth-child(6)



}

function sleepFor(sleepDuration) {
  var now = new Date().getTime();
  while (new Date().getTime() < now + sleepDuration) { /* do nothing */ }
}

async function sleep(time) {
  return await new Promise(function (resolve) {
      setTimeout(() => {
          resolve()
      }, time)
  })

}

async function checkMessage(x, mail , page2) {
  let dalee_true = false
  let description = ''
  if (JSON.stringify(x).indexOf("retry timeout exceeded") != -1) {
    description = 'timeout_over' // 'Таймаут повторных попыток закончлися'
    dalee_true = true
  }

  if (JSON.stringify(x).indexOf("Error This message was created automatically by mail delivery software.") != -1 || JSON.stringify(x).indexOf('This message was created automatically by mail delivery software.') != -1 || JSON.stringify(x).indexOf("I'm sorry to have to inform you that your message could notbe delivered to one or more recipients")) {
    description = 'SPAM' // 'Подозрение в спаме'
    dalee_true = true
  }

  if (JSON.stringify(x).indexOf("550 Invalid Recipient") != -1 || JSON.stringify(x).indexOf("No such user!") != -1 || JSON.stringify(x).indexOf("User unknown") != -1) {
    description = 'mail_not_found' // 'Получатель не найден'
    dalee_true = true
  }

  if (JSON.stringify(x).indexOf("Email rejected due to security policies") != -1) {
    description = 'rejected_security' // 'Отклонено из-за политики безопасности'
    dalee_true = true
  }

  if (JSON.stringify(x).indexOf("This message is blocked due to security reason") != -1) {
    description = 'blocked' // 'сообщение заблокировано по соображениям безопасности'
    dalee_true = true
  }
  if (dalee_true == true) {
    let msg_server = await otpravka_mail_in_server(mail, description)
    console.log("MSG_SERVER ", msg_server)
    await sleep(100)
    if (msg_server.msg == 'succes' || msg_server.msg == 'error') {
      console.log("Удаляю письмо.")
      await page2.waitForTimeout(1000)
      await page2.click('#rcmbtn112')
      console.log("! ! ! ! ! ")
    } 
    console.log("Все заебись братуха\n")

  } else {
    console.log("Не нашёл наименование ошибки в этом письма! \n")
  }

}


//Функция отправки на удаленный сервер 

async function otpravka_mail_in_server(email, description) {
  return await new Promise(function (resolve, reject) {
    let options = {
      url: 'https://s-k156.ru/data_refinement',
      json: true,
      body: {
        action: 'update_status_mail_sender',
        email: email,
        description: description
      }
    };
    request.post(options, (err, res, body) => {
      if (err) {
        console.log(err);
        return resolve(err)
      }
      console.log('Ответ сервера: ', body)
      return resolve(body)
    });
  });
}
