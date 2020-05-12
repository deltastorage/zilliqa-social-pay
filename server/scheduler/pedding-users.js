const bunyan = require('bunyan');
const { Op } = require('sequelize');
const zilliqa = require('../zilliqa');
const models = require('../models');
const { toBech32Address } = require('@zilliqa-js/crypto');

const {
  User,
  Notification
} = models.sequelize.models;
const ENV = process.env.NODE_ENV || 'development';
const REDIS_CONFIG = require('../config/redis')[ENV];
const notificationTypes = new Notification().types;
const log = bunyan.createLogger({ name: 'scheduler:peddign-users' });

module.exports = async function (redisClient) {
  const users = await User.findAndCountAll({
    where: {
      synchronization: true,
      zilAddress: {
        [Op.not]: null
      },
      updatedAt: {
        // Ten minuts.
        [Op.lt]: new Date(new Date() - 24 * 60 * 250)
      }
    },
    limit: 100
  });

  log.info('Need check', users.count, 'users.');

  if (users.count < 0) {
    return null;
  }

  const onlyProfiles = users.rows.map(async (user) => {
    const profileId = user.profileId;
    const usersFromContract = await zilliqa.getonfigureUsers([profileId]);

    if (!usersFromContract || !usersFromContract[profileId]) {
      log.warn('FAIL to configureUser with profileID:', profileId);

      await user.update({
        synchronization: true,
        lastAction: 0
      });

      return null;
    }

    log.info('User with profileID:', profileId, 'has been synchronized from blockchain.');

    await user.update({
      synchronization: false,
      zilAddress: toBech32Address(usersFromContract[profileId]),
      lastAction: 0
    });
    const notification = await Notification.create({
      UserId: user.id,
      type: notificationTypes.addressConfigured,
      title: 'Account',
      description: 'Address configured!'
    });

    redisClient.publish(REDIS_CONFIG.channels.WEB, JSON.stringify({
      model: Notification.tableName,
      body: notification
    }));
  });

  await Promise.all(onlyProfiles);
}
